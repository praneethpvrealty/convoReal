import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The Transaction Workspace timeline.
 *
 * `deal_events` is insert-only at the database (SELECT/INSERT grants,
 * an INSERT policy that pins `actor_id` to the caller, and a trigger
 * that refuses UPDATE and DELETE). This module is the only writer in
 * application code and never exposes an edit.
 */

export type DealEventType =
  | 'created'
  | 'converted_from_journey'
  | 'stage_changed'
  | 'financials_updated'
  | 'milestone_added'
  | 'milestone_updated'
  | 'task_added'
  | 'document_added'
  | 'document_status_changed'
  | 'document_superseded'
  | 'group_changed'
  | 'note_added';

export type DealEventSource = 'web' | 'mobile' | 'api' | 'system';

export interface DealEvent {
  id: string;
  account_id: string;
  deal_id: string;
  event_type: DealEventType;
  source: DealEventSource;
  actor_id: string | null;
  actor_name: string | null;
  title: string;
  metadata: Record<string, unknown>;
  dedupe_key: string | null;
  created_at: string;
}

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export const DEAL_EVENT_LABELS: Record<DealEventType, string> = {
  created: 'Deal created',
  converted_from_journey: 'Converted from journey',
  stage_changed: 'Stage changed',
  financials_updated: 'Financials updated',
  milestone_added: 'Milestone added',
  milestone_updated: 'Milestone updated',
  task_added: 'Task added',
  document_added: 'Document added',
  document_status_changed: 'Document status changed',
  document_superseded: 'Document superseded',
  group_changed: 'Bundle changed',
  note_added: 'Note',
};

export function parseEventSource(v: unknown): DealEventSource {
  return v === 'mobile' || v === 'api' ? v : 'web';
}

export interface WriteDealEventArgs {
  db: SupabaseClient;
  accountId: string;
  dealId: string;
  eventType: DealEventType;
  title: string;
  actorId: string | null;
  actorName?: string | null;
  source?: DealEventSource;
  metadata?: Record<string, unknown>;
  dedupeKey?: string | null;
}

export interface WriteDealEventResult {
  ok: boolean;
  duplicate: boolean;
  eventId: string | null;
  error: string | null;
}

export async function writeDealEvent({
  db,
  accountId,
  dealId,
  eventType,
  title,
  actorId,
  actorName,
  source = 'web',
  metadata,
  dedupeKey,
}: WriteDealEventArgs): Promise<WriteDealEventResult> {
  const { data, error } = await db
    .from('deal_events')
    .insert({
      account_id: accountId,
      deal_id: dealId,
      event_type: eventType,
      source,
      actor_id: actorId,
      actor_name: actorName ?? null,
      title: title.slice(0, 200),
      metadata: metadata ?? {},
      dedupe_key: dedupeKey ?? null,
    })
    .select('id')
    .single();

  if (!error) {
    return { ok: true, duplicate: false, eventId: data?.id ?? null, error: null };
  }
  if (error.code === '23505') {
    return { ok: true, duplicate: true, eventId: null, error: null };
  }
  return { ok: false, duplicate: false, eventId: null, error: error.message };
}

const NOTE_MAX = 2000;

export function parseNoteInput(
  raw: unknown
): { ok: true; value: { note: string; source: DealEventSource } } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'note is required' };
  const input = raw as Record<string, unknown>;
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!note) return { ok: false, error: 'note is required' };
  if (note.length > NOTE_MAX) {
    return { ok: false, error: `Note must be ${NOTE_MAX.toLocaleString()} characters or less` };
  }
  return { ok: true, value: { note, source: parseEventSource(input.source) } };
}
