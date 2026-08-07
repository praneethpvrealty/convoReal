// Ask a buyer for alert consent at the moment their window is open.
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
import { buildConsentRequestMessage } from './digest';

const BUYER_CLASSIFICATIONS = ['Buyer', 'Owner & Buyer'];

/**
 * Should this inbound message be followed by the consent question?
 *
 * Only for a buyer who has told us what they want, has not answered
 * either way, and has never been asked. Every one of those is a hard
 * gate — being asked twice is the failure mode consent bookkeeping
 * exists to prevent.
 */
export function shouldAskBuyerConsent(contact: Contact): boolean {
  if (!BUYER_CLASSIFICATIONS.includes(contact.classification ?? '')) return false;
  if ((contact.buyer_alerts_consent ?? 'pending') !== 'pending') return false;
  if (contact.buyer_alerts_consent_requested_at) return false;
  return hasBuyerBrief(contact);
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
  matchCount: number,
): Promise<string | null> {
  if (!shouldAskBuyerConsent(contact)) return null;

  const { data, error } = await db
    .from('contacts')
    .update({ buyer_alerts_consent_requested_at: new Date().toISOString() })
    .eq('id', contact.id)
    .eq('account_id', accountId)
    .is('buyer_alerts_consent_requested_at', null)
    .select('id');
  // Zero rows means a racing tick claimed the ask first — stay quiet.
  if (error || !data || data.length === 0) return null;

  return buildConsentRequestMessage({
    contactName: contact.name,
    matchCount,
    agencyName,
  });
}
