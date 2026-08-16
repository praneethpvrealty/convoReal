// Ask a buyer — or a lead who only ever enquired — for alert consent at
// the moment their window is open.
//
// The digest asks pending buyers once a day at 11:15 IST, which only
// reaches whoever happens to be mid-chat at that minute — so buyers
// piled up at 'pending' and the digest starved. The template built to
// fix that came back from Meta as MARKETING, and rightly so: soliciting
// an opt-in to future alerts is marketing by Meta's own test, whatever
// the wording. Utility covers the CONFIRMATION of an opt-in, not the
// request for one.
//
// So the ask moves to where it is both free and compliant: the moment a
// buyer messages us, the 24-hour window is open and a free-form
// question needs no template and no category at all.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import { hasBuyerBrief } from './matches-ranking';
import {
  buildConsentRequestMessage,
  buildEnquiryConsentRequestMessage,
} from './digest';

const BUYER_CLASSIFICATIONS = ['Buyer', 'Owner & Buyer'];
const OWNER_CLASSIFICATIONS = ['Owner', 'Seller'];

/**
 * Which ask this contact is due, or null for none.
 *
 * 'brief' — a buyer who has told us what they want, so we can promise
 * matches. 'enquiry' — a lead who enquired about a listing and never
 * gave a brief; there are no matches to promise, but the enquiry itself
 * is a stated interest and the ask hangs on that instead.
 *
 * Unanswered and never-asked are hard gates for both. Being asked twice
 * is the failure mode consent bookkeeping exists to prevent.
 */
export function buyerConsentAskReason(
  contact: Contact
): 'brief' | 'enquiry' | null {
  if ((contact.buyer_alerts_consent ?? 'pending') !== 'pending') return null;
  if (contact.buyer_alerts_consent_requested_at) return null;
  if (
    BUYER_CLASSIFICATIONS.includes(contact.classification ?? '') &&
    hasBuyerBrief(contact)
  ) {
    return 'brief';
  }
  // An owner or seller is asked for digest consent instead — a
  // different subscription, on a different column.
  if (OWNER_CLASSIFICATIONS.includes(contact.classification ?? '')) return null;
  return contact.last_inquired_property_id ? 'enquiry' : null;
}

export function shouldAskBuyerConsent(contact: Contact): boolean {
  return buyerConsentAskReason(contact) !== null;
}

/**
 * The question itself, plus the bookkeeping that stops it repeating.
 * Returns the text to send, or null when this contact must not be
 * asked. Marking BEFORE the send is deliberate: a double-ask is worse
 * than a missed one, and the buyer can always reply START ALERTS.
 */
export async function claimBuyerConsentAsk(
  db: SupabaseClient,
  accountId: string,
  contact: Contact,
  agencyName: string | null,
  matchCount: number
): Promise<string | null> {
  const reason = buyerConsentAskReason(contact);
  if (!reason) return null;

  const { data, error } = await db
    .from('contacts')
    .update({ buyer_alerts_consent_requested_at: new Date().toISOString() })
    .eq('id', contact.id)
    .eq('account_id', accountId)
    .is('buyer_alerts_consent_requested_at', null)
    .select('id');
  // Zero rows means a racing tick claimed the ask first — stay quiet.
  if (error || !data || data.length === 0) return null;

  if (reason === 'enquiry') {
    return buildEnquiryConsentRequestMessage({
      contactName: contact.name,
      propertyTitle: await enquiredPropertyTitle(db, accountId, contact),
      agencyName,
    });
  }

  return buildConsentRequestMessage({
    contactName: contact.name,
    matchCount,
    agencyName,
  });
}

/** Best-effort: the ask still reads fine without a title. */
async function enquiredPropertyTitle(
  db: SupabaseClient,
  accountId: string,
  contact: Contact
): Promise<string | null> {
  if (!contact.last_inquired_property_id) return null;
  const { data } = await db
    .from('properties')
    .select('title')
    .eq('id', contact.last_inquired_property_id)
    .eq('account_id', accountId)
    .maybeSingle();
  return (data as { title: string } | null)?.title ?? null;
}
