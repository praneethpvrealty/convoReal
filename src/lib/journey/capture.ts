/**
 * Journey auto-capture — turns "property shared to contact" moments
 * into journey_items rows without the agent lifting a finger.
 *
 * Client-side helper (uses the browser Supabase client) called from:
 *   - the WhatsApp share dialog, after a confirmed send
 *     (source 'whatsapp_share', hidden = true → lands in the
 *     Captured tray on /journey instead of hogging the canvas)
 *   - the /journey page's "Import from chat" and "Import inquiries"
 *     buttons (explicit user action → visible immediately)
 *
 * Idempotent by construction: the upsert ignores pairs that already
 * exist (the UNIQUE(account_id, contact_id, property_id) constraint),
 * so re-sharing a property never duplicates, resurrects a dropped
 * branch, or un-hides anything the agent tucked away.
 */

import { createClient } from '@/lib/supabase/client';
import type { JourneyItemSource, JourneyStage } from '@/types';
import { DEFAULT_JOURNEY_STAGES } from '@/components/journey/shared';

/**
 * Load the account's journey stages, seeding the defaults first if the
 * account has never opened /journey. Mirrors the page's own seed so a
 * share can be captured before the map is ever visited.
 */
export async function ensureJourneyStages(
  accountId: string
): Promise<JourneyStage[]> {
  const supabase = createClient();
  const load = async () => {
    const { data, error } = await supabase
      .from('journey_stages')
      .select('*')
      .order('position');
    if (error) {
      console.error('Failed to load journey stages:', error.message);
      return [];
    }
    return (data ?? []) as JourneyStage[];
  };

  let stages = await load();
  if (stages.length === 0) {
    const { error } = await supabase.from('journey_stages').insert(
      DEFAULT_JOURNEY_STAGES.map((s, idx) => ({
        account_id: accountId,
        name: s.name,
        color: s.color,
        position: idx,
      }))
    );
    // A racing seed from another tab violates nothing (no unique
    // name constraint) but is rare enough not to guard beyond the
    // page's own StrictMode ref; a failed insert just re-loads.
    if (error) console.error('Failed to seed journey stages:', error.message);
    stages = await load();
  }
  return stages;
}

export interface CaptureJourneyItemsInput {
  accountId: string;
  /** auth.users.id of the acting agent, for created_by / event audit. */
  userId?: string | null;
  pairs: Array<{ contactId: string; propertyId: string }>;
  source: JourneyItemSource;
  /** true → off-canvas, waits in the Captured tray. */
  hidden: boolean;
}

export interface CaptureResult {
  /** Rows actually created — 0 with a null error means every pair
   *  was already on the journey. */
  created: number;
  /** Database failure, verbatim — callers surface it so a broken
   *  capture never masquerades as "nothing new". */
  error: string | null;
}

/**
 * Upsert contact×property pairs at the first journey stage, logging an
 * 'added' event for each NEW row. Existing pairs are left completely
 * untouched.
 */
export async function captureJourneyItems({
  accountId,
  userId,
  pairs,
  source,
  hidden,
}: CaptureJourneyItemsInput): Promise<CaptureResult> {
  if (pairs.length === 0) return { created: 0, error: null };
  const supabase = createClient();

  const stages = await ensureJourneyStages(accountId);
  const firstStage = stages[0];
  if (!firstStage) {
    return { created: 0, error: 'Journey stages could not be loaded' };
  }

  // Dedupe input pairs (a broadcast can list the same contact twice
  // via merged phones) — the DB constraint would reject the batch
  // otherwise, since ignoreDuplicates only skips conflicts with
  // EXISTING rows, not duplicates within the same insert.
  const seen = new Set<string>();
  const payload = pairs
    .filter((p) => {
      const key = `${p.contactId}:${p.propertyId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({
      account_id: accountId,
      contact_id: p.contactId,
      property_id: p.propertyId,
      stage_id: firstStage.id,
      source,
      hidden,
      created_by: userId ?? null,
    }));

  // Never route a property into its own owner's buyer journey — an
  // owner is the seller of that listing, not a buyer for it. This is
  // the single choke point for every capture path (WhatsApp share,
  // chat import, inquiry import, manual add), so guarding here keeps a
  // contact out of their own property's funnel in all directions.
  const propertyIds = Array.from(new Set(payload.map((p) => p.property_id)));
  const { data: owned } = await supabase
    .from('properties')
    .select('id, owner_contact_id')
    .in('id', propertyIds);
  const ownerByProperty = new Map(
    (owned ?? []).map((p) => [
      p.id as string,
      p.owner_contact_id as string | null,
    ])
  );
  const routable = payload.filter(
    (p) => ownerByProperty.get(p.property_id) !== p.contact_id
  );
  if (routable.length === 0) return { created: 0, error: null };

  const { data, error } = await supabase
    .from('journey_items')
    .upsert(routable, {
      onConflict: 'account_id,contact_id,property_id',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) {
    console.error('Journey capture failed:', error.message);
    return { created: 0, error: error.message };
  }

  const created = data ?? [];
  if (created.length > 0) {
    const { error: evError } = await supabase.from('journey_events').insert(
      created.map((row) => ({
        account_id: accountId,
        item_id: row.id,
        event_type: 'added',
        to_stage_id: firstStage.id,
        reason:
          source === 'whatsapp_share'
            ? 'Captured from WhatsApp share'
            : source === 'chat_import'
              ? 'Imported from chat history'
              : source === 'inquiry_import'
                ? 'Imported from property inquiries'
                : null,
        created_by: userId ?? null,
      }))
    );
    if (evError) {
      // Timeline entry is best-effort — the item row is already in;
      // don't fail the capture over its audit line.
      console.error('Journey capture event log failed:', evError.message);
    }
  }
  return { created: created.length, error: null };
}
