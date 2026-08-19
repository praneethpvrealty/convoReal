import { SupabaseClient } from '@supabase/supabase-js';

import type { JourneyEventType } from '@/types';

export interface WriteJourneyEventArgs {
  db: SupabaseClient;
  accountId: string;
  itemId: string;
  eventType: JourneyEventType;
  createdBy?: string | null;
  fromStageId?: string | null;
  toStageId?: string | null;
  reason?: string | null;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface WriteJourneyEventResult {
  ok: boolean;
  duplicate: boolean;
  eventId: string | null;
  error: string | null;
}

/**
 * Insert a journey event, treating unique-key collisions on a provided
 * dedupe key as an idempotent no-op.
 */
export async function writeJourneyEvent({
  db,
  accountId,
  itemId,
  eventType,
  createdBy,
  fromStageId,
  toStageId,
  reason,
  dedupeKey,
  metadata,
}: WriteJourneyEventArgs): Promise<WriteJourneyEventResult> {
  const { data, error } = await db
    .from('journey_events')
    .insert({
      account_id: accountId,
      item_id: itemId,
      event_type: eventType,
      from_stage_id: fromStageId,
      to_stage_id: toStageId,
      reason: reason ?? null,
      created_by: createdBy,
      metadata: metadata ?? {},
      dedupe_key: dedupeKey,
    })
    .select('id')
    .single();

  if (!error) {
    return {
      ok: true,
      duplicate: false,
      eventId: (data as { id?: string } | null)?.id ?? null,
      error: null,
    };
  }

  if (error.code === '23505') {
    return {
      ok: true,
      duplicate: true,
      eventId: null,
      error: null,
    };
  }

  return {
    ok: false,
    duplicate: false,
    eventId: null,
    error: error.message,
  };
}

