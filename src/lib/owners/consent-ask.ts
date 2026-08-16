// Ask an owner for digest consent at the moment their window is open.
//
// The owner digest cron already asks (owner-digest.ts sendConsentRequest),
// but only once a day and template-first. The hour is not the problem —
// it runs 04:30 UTC / 10:00 IST, a deliberately reasonable one. The
// problem is that an open 24-hour window needs the owner to have
// messaged US within the last day, which on any given morning almost
// none of them have. So the cron falls to the template, and when the
// account has no approved consent template it skips the owner outright
// and they sit at 'pending' forever.
//
// An owner who messages us has opened that window themselves. The ask is
// then free-form: no template, no category, no Meta review — the same
// reason the buyer ask lives on the inbound path (see
// src/lib/buyer/consent-ask.ts, which explains why an ask template can
// never be UTILITY).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildConsentRequestMessage,
  digestPeriod,
  CONSENT_BUTTONS,
} from './owner-digest';
import type { OwnedListing } from './owner-reply';

export interface OwnerConsentFields {
  id: string;
  name?: string | null;
  owner_digest_consent?: string | null;
  owner_digest_consent_requested_at?: string | null;
}

/**
 * Should this inbound message be followed by the consent question?
 *
 * Only an owner with listings we could actually report on, still
 * unanswered, and never asked before. Being asked twice is the failure
 * mode consent bookkeeping exists to prevent.
 */
export function shouldAskOwnerConsent(
  contact: OwnerConsentFields,
  listings: OwnedListing[]
): boolean {
  if (listings.length === 0) return false;
  if ((contact.owner_digest_consent ?? 'pending') !== 'pending') return false;
  if (contact.owner_digest_consent_requested_at) return false;
  return true;
}

export { CONSENT_BUTTONS };

/**
 * The question itself, plus the bookkeeping that stops it repeating.
 * Returns the body text to send, or null when this owner must not be
 * asked.
 *
 * Two claims, both taken BEFORE the send: the owner_digest_log day slot
 * the cron uses, so a cron tick and an inbound message on the same IST
 * day cannot both ask; and the requested_at stamp, which is what makes
 * the cron skip this owner on every later day too. A send that then
 * fails costs one missed ask — the owner can still reply START UPDATES,
 * and a double-ask would be the worse outcome.
 */
export async function claimOwnerConsentAsk(
  db: SupabaseClient,
  accountId: string,
  contact: OwnerConsentFields,
  listings: OwnedListing[]
): Promise<string | null> {
  if (!shouldAskOwnerConsent(contact, listings)) return null;

  const period = digestPeriod('daily');
  const { error: claimErr } = await db.from('owner_digest_log').insert({
    account_id: accountId,
    owner_contact_id: contact.id,
    digest_date: period.digestDate,
    period_start: period.startIso,
    period_end: period.endIso,
    stats: [],
    channel: 'consent_requested',
  });
  // 23505 means the cron already claimed today's slot for this owner.
  if (claimErr) return null;

  const { data, error } = await db
    .from('contacts')
    .update({
      owner_digest_consent_requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', contact.id)
    .eq('account_id', accountId)
    .is('owner_digest_consent_requested_at', null)
    .select('id');
  if (error || !data || data.length === 0) return null;

  return buildConsentRequestMessage({
    name: contact.name ?? null,
    properties: listings.map((listing) => ({ title: listing.title })),
  });
}
