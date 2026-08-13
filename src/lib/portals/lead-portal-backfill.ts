// ============================================================
// Recovering the portal ad a lead came in on, after the fact.
//
// contacts.lead_portal / lead_portal_listing_id (migration 264) are
// written by the lead webhook, so they exist only for leads that
// arrived after it shipped. Every earlier lead is invisible to the
// unmapped-ads queue and to the one-tap assertion — including the ones
// sitting in Needs Review with a listing the scorer guessed.
//
// email_sync_logs kept the raw mail, so the id is still recoverable.
// This is the pure half: given a log row, which portal was it and what
// ad did it quote. It reuses the same functions the webhook parses
// with, so the backfill cannot disagree with live ingestion about what
// an ad id looks like.
// ============================================================

import {
  parseListingIdFromLead,
  portalKeyFromSource,
} from './listing-identity';
import type { PortalKey } from './post-kit';

export interface SyncLogRow {
  sender: string | null;
  subject: string | null;
  body_preview: string | null;
  extracted_phone: string | null;
  created_at: string;
}

export interface RecoveredPortalRef {
  portal: PortalKey;
  listingId: string;
  phone: string;
}

/**
 * The portal reference a logged lead email carries, or null.
 *
 * portalKeyFromSource strips to alphanumerics and substring-matches, so
 * the whole envelope can be handed to it — the sender is what identifies
 * the portal when a body never spells the brand out, exactly as in
 * parsePortalLead.
 *
 * Without a phone there is nothing to attach the reference to: sync logs
 * hold no contact id, and the phone is the only key back to the contact
 * the webhook created from the same mail.
 */
export function recoverPortalRef(log: SyncLogRow): RecoveredPortalRef | null {
  const phone = log.extracted_phone?.trim();
  if (!phone) return null;

  const portal = portalKeyFromSource(
    `${log.sender ?? ''} ${log.subject ?? ''} ${log.body_preview ?? ''}`
  );
  if (!portal) return null;

  const listingId = parseListingIdFromLead(
    portal,
    `${log.subject ?? ''}\n${log.body_preview ?? ''}`
  );
  if (!listingId) return null;

  return { portal, listingId, phone };
}

/**
 * One reference per phone, newest first — a buyer who enquired twice
 * gets the ad they enquired about most recently, which is what
 * last_inquired_property_id means everywhere else.
 *
 * Logs are expected newest-first; the first hit for a phone wins, so
 * ordering is the caller's contract rather than a re-sort here.
 */
export function latestRefsByPhone(
  logs: SyncLogRow[]
): Map<string, RecoveredPortalRef> {
  const byPhone = new Map<string, RecoveredPortalRef>();
  for (const log of logs) {
    const ref = recoverPortalRef(log);
    if (!ref) continue;
    if (!byPhone.has(ref.phone)) byPhone.set(ref.phone, ref);
  }
  return byPhone;
}
