// ============================================================
// Click-to-WhatsApp (CTWA) ad attribution — Meta Ads Phase A.
//
// Meta attaches a `referral` object to the FIRST inbound WhatsApp
// message of a thread that a buyer started by tapping a Click-to-
// WhatsApp ad on Instagram/Facebook. This module records that referral
// (see migration 105) and stamps the contact so the agent can see the
// lead came from an ad — reusing the existing `referrer`/`source`
// fields the contact UI already renders, so no new UI is needed.
//
// The pure helpers (extractReferral / formatReferrerLabel /
// deriveContactUpgrade) are transport-free and unit-tested;
// processCtwaReferral does the DB writes.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Shape of `message.referral` as delivered by the WhatsApp webhook. */
export interface WhatsAppReferral {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  ctwa_clid?: string;
}

/** Normalized referral, trimmed and with empty strings dropped. */
export interface NormalizedReferral {
  sourceType: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  mediaType: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  ctwaClid: string | null;
}

function clean(v: string | undefined | null): string | null {
  const t = (v ?? '').trim();
  return t.length ? t : null;
}

/**
 * Extracts a normalized referral from a raw webhook referral object.
 * Returns null when there's no meaningful attribution (no ad id and no
 * click id) — those are the two fields that make it a real CTWA lead.
 */
export function extractReferral(referral: WhatsAppReferral | undefined | null): NormalizedReferral | null {
  if (!referral) return null;
  const sourceId = clean(referral.source_id);
  const ctwaClid = clean(referral.ctwa_clid);
  if (!sourceId && !ctwaClid) return null;

  return {
    sourceType: clean(referral.source_type),
    sourceId,
    sourceUrl: clean(referral.source_url),
    headline: clean(referral.headline),
    body: clean(referral.body),
    mediaType: clean(referral.media_type),
    imageUrl: clean(referral.image_url),
    videoUrl: clean(referral.video_url),
    ctwaClid,
  };
}

/** Human-readable referrer label for the contact's `referrer` field. */
export function formatReferrerLabel(ref: NormalizedReferral): string {
  return ref.headline ? `Meta Ad — "${ref.headline}"` : 'Meta Ad';
}

/** Short source badge value for the contact's `source` field. */
export const CTWA_SOURCE = 'Meta Ad';

interface ContactUpgradeInput {
  source?: string | null;
  referrer?: string | null;
  classification?: string | null;
}

/**
 * Decides which contact fields to stamp from a referral. Upgrade-only:
 * never overwrites a value the contact already has, so re-processing
 * (webhook redelivery) or an existing richer attribution is preserved.
 * `classification` is promoted to 'Buyer' only from the generic
 * 'Others'/empty default — same rule as the property-code matcher.
 */
export function deriveContactUpgrade(
  current: ContactUpgradeInput,
  ref: NormalizedReferral,
): { source?: string; referrer?: string; classification?: 'Buyer' } {
  const update: { source?: string; referrer?: string; classification?: 'Buyer' } = {};
  if (!current.source || !current.source.trim()) update.source = CTWA_SOURCE;
  if (!current.referrer || !current.referrer.trim()) update.referrer = formatReferrerLabel(ref);
  if (!current.classification || current.classification === 'Others') update.classification = 'Buyer';
  return update;
}

interface ProcessArgs {
  admin: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId: string;
  messageId: string;
  referral: WhatsAppReferral | undefined | null;
  contact: ContactUpgradeInput;
}

/**
 * Records the CTWA referral and stamps the contact. Best-effort
 * throughout — attribution must never break inbound message handling.
 * Returns the property id if the originating ad is one we created
 * (Phase C's ad_campaigns), so the caller can skip the text-based
 * property matcher and let the authoritative ad linkage win. Until
 * Phase C ships, ad_campaigns doesn't exist and this always returns
 * null — the referral is still captured and the contact still stamped.
 */
export async function processCtwaReferral(args: ProcessArgs): Promise<{ linkedPropertyId: string | null }> {
  const { admin, accountId, contactId, conversationId, messageId, contact } = args;

  const ref = extractReferral(args.referral);
  if (!ref) return { linkedPropertyId: null };

  // 1. Record the referral (idempotent on message_id).
  try {
    await admin
      .from('ctwa_referrals')
      .upsert(
        {
          account_id: accountId,
          contact_id: contactId,
          conversation_id: conversationId,
          message_id: messageId,
          source_type: ref.sourceType,
          source_id: ref.sourceId,
          source_url: ref.sourceUrl,
          headline: ref.headline,
          body: ref.body,
          media_type: ref.mediaType,
          image_url: ref.imageUrl,
          video_url: ref.videoUrl,
          ctwa_clid: ref.ctwaClid,
        },
        { onConflict: 'message_id', ignoreDuplicates: true },
      );
  } catch (err) {
    console.error('[ctwa-attribution] referral insert failed (non-fatal):', err);
  }

  // 2. Stamp the contact (upgrade-only).
  try {
    const update = deriveContactUpgrade(contact, ref);
    if (Object.keys(update).length > 0) {
      await admin
        .from('contacts')
        .update({ ...update, updated_at: new Date().toISOString() })
        .eq('id', contactId);
    }
  } catch (err) {
    console.error('[ctwa-attribution] contact stamp failed (non-fatal):', err);
  }

  // 3. Authoritative property linkage from the ad we created (Phase C).
  //    ad_campaigns may not exist yet — treat any error as "no link".
  if (ref.sourceId) {
    try {
      const { data: campaign } = await admin
        .from('ad_campaigns')
        .select('property_id')
        .eq('account_id', accountId)
        .eq('ad_id', ref.sourceId)
        .maybeSingle();

      const propertyId = (campaign?.property_id as string | undefined) ?? null;
      if (propertyId) {
        await admin
          .from('contacts')
          .update({
            last_inquired_property_id: propertyId,
            status: 'pending_review',
            updated_at: new Date().toISOString(),
          })
          .eq('id', contactId);
        return { linkedPropertyId: propertyId };
      }
    } catch {
      // ad_campaigns absent (pre-Phase C) or lookup failed — fall through.
    }
  }

  return { linkedPropertyId: null };
}
