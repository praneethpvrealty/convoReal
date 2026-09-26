/**
 * Journey auto-capture, server side.
 *
 * The browser helper in capture.ts only ever ran behind the share
 * dialog's broadcast paths. Every other share surface — the share sheet
 * on web and mobile, a contact's "share listings", Radar sends, the
 * bot's own listing sends — wrote the property_shares ledger from a
 * server route and never touched the journey, so a listing could be
 * shared for weeks without a branch appearing on the buyer's journey.
 *
 * This is the one capture the ledger writers call (share-property-send
 * .ts), so recording a share and putting the pair on the journey are a
 * single step wherever the share happened. Idempotent by construction:
 * the upsert ignores pairs that already exist, so a re-share never
 * duplicates, resurrects a dropped branch, or un-hides one the agent
 * tucked away.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { JourneyItemSource } from '@/types';

export interface JourneyStageRow {
  id: string;
  name: string;
  position: number;
}

export interface JourneyItemRow {
  id: string;
  stage_id: string;
  status: string;
  planned_at?: string | null;
}

/** The account's mirrored journey stages, creating the default board
 *  when the account has none. Service-role safe: the mirror function
 *  is not guarded by the caller's membership. */
export async function loadJourneyStages(
  db: SupabaseClient,
  accountId: string
): Promise<JourneyStageRow[]> {
  const load = async () => {
    const { data } = await db
      .from('journey_stages')
      .select('id, name, position')
      .eq('account_id', accountId)
      .not('pipeline_stage_id', 'is', null)
      .order('position');
    return (data ?? []) as JourneyStageRow[];
  };
  let stages = await load();
  if (stages.length === 0) {
    const { error } = await db.rpc('journey_stages_for_account', {
      p_account_id: accountId,
    });
    if (error)
      console.error('[journey/capture] stage mirror failed:', error.message);
    stages = await load();
  }
  return stages;
}

export function captureReasonForSource(source: JourneyItemSource): string {
  switch (source) {
    case 'whatsapp_share':
      return 'Captured from WhatsApp share';
    case 'chat_import':
      return 'Imported from chat history';
    case 'inquiry_import':
      return 'Imported from property inquiries';
    default:
      return 'Added manually';
  }
}

export interface EnsureJourneyItemInput {
  accountId: string;
  userId: string | null;
  contactId: string;
  propertyId: string;
  source: JourneyItemSource;
  hidden: boolean;
  /** The 'added' event's reason when the pair is new. */
  reason: string;
  /** Already-loaded stages, when the caller has them. */
  stages?: JourneyStageRow[];
}

/**
 * The journey item for a contact×property pair, created at the first
 * stage when the pair was never captured. An existing pair is returned
 * untouched, whatever its stage, status or visibility.
 */
export async function ensureJourneyItem(
  db: SupabaseClient,
  input: EnsureJourneyItemInput
): Promise<JourneyItemRow | null> {
  const { accountId, userId, contactId, propertyId } = input;
  const read = async () => {
    const { data } = await db
      .from('journey_items')
      .select('id, stage_id, status, planned_at')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('property_id', propertyId)
      .maybeSingle();
    return (data ?? null) as JourneyItemRow | null;
  };
  const existing = await read();
  if (existing) return existing;

  const stages = input.stages ?? (await loadJourneyStages(db, accountId));
  const firstStage = stages[0];
  if (!firstStage) return null;

  const { data: inserted, error } = await db
    .from('journey_items')
    .upsert(
      {
        account_id: accountId,
        contact_id: contactId,
        property_id: propertyId,
        stage_id: firstStage.id,
        source: input.source,
        hidden: input.hidden,
        created_by: userId,
      },
      {
        onConflict: 'account_id,contact_id,property_id',
        ignoreDuplicates: true,
      }
    )
    .select('id, stage_id, status, planned_at');
  if (error) {
    console.error('[journey/capture] item capture failed:', error.message);
    return read();
  }
  const created = (inserted ?? [])[0] as JourneyItemRow | undefined;
  if (!created) return read();

  const { error: evError } = await db.from('journey_events').insert({
    account_id: accountId,
    item_id: created.id,
    event_type: 'added',
    to_stage_id: firstStage.id,
    reason: input.reason,
    created_by: userId,
  });
  if (evError)
    console.error('[journey/capture] capture event failed:', evError.message);
  return created;
}

export interface CaptureJourneyItemsInput {
  accountId: string;
  userId: string | null;
  pairs: Array<{ contactId: string; propertyId: string }>;
  source: JourneyItemSource;
  hidden: boolean;
}

/**
 * Upsert contact×property pairs at the first journey stage, logging an
 * 'added' event for each NEW row. Existing pairs are left untouched.
 * Best-effort for callers: the outcome is reported, never thrown.
 */
export async function captureJourneyItems(
  db: SupabaseClient,
  { accountId, userId, pairs, source, hidden }: CaptureJourneyItemsInput
): Promise<{ created: number; error: string | null }> {
  const seen = new Set<string>();
  const unique = pairs.filter((p) => {
    const key = `${p.contactId}:${p.propertyId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) return { created: 0, error: null };

  const stages = await loadJourneyStages(db, accountId);
  const firstStage = stages[0];
  if (!firstStage) {
    return { created: 0, error: 'Journey stages could not be loaded' };
  }

  const { data, error } = await db
    .from('journey_items')
    .upsert(
      unique.map((p) => ({
        account_id: accountId,
        contact_id: p.contactId,
        property_id: p.propertyId,
        stage_id: firstStage.id,
        source,
        hidden,
        created_by: userId,
      })),
      {
        onConflict: 'account_id,contact_id,property_id',
        ignoreDuplicates: true,
      }
    )
    .select('id');
  if (error) {
    console.error('[journey/capture] capture failed:', error.message);
    return { created: 0, error: error.message };
  }

  const created = (data ?? []) as Array<{ id: string }>;
  if (created.length > 0) {
    const { error: evError } = await db.from('journey_events').insert(
      created.map((row) => ({
        account_id: accountId,
        item_id: row.id,
        event_type: 'added',
        to_stage_id: firstStage.id,
        reason: captureReasonForSource(source),
        created_by: userId,
      }))
    );
    if (evError)
      console.error(
        '[journey/capture] capture event log failed:',
        evError.message
      );
  }
  return { created: created.length, error: null };
}
