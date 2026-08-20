// ============================================================
// Filing a gap without filing it twice.
//
// The sweep runs every morning over a window that overlaps nothing,
// but the CONDITIONS it reports persist: a question nobody answered
// on Tuesday is still unanswered on Wednesday, and the thread it sits
// in is still there to be read. Raised naively, the same gap would
// arrive fresh every morning until someone dealt with it, which is
// precisely how a review queue teaches people to stop opening it.
//
// So a gap has an identity independent of the morning that found it.
// The key is built from what the gap is ABOUT — kind plus subject —
// and never from the model's wording, which drifts between runs even
// when nothing about the situation has. Meeting an existing open row
// bumps its count and its evidence instead of inserting; the row's
// age becomes the escalation signal the digest sorts on.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DetectedGap, SweepThread } from './types';

/**
 * Stable identity for "this same gap".
 *
 * Subject is the conversation where there is one and the contact
 * otherwise, so the account holder's personal WhatsApp — which has no
 * conversation row — still dedupes per person rather than per run.
 * A gap with neither is keyed on nothing stable and is dropped by the
 * caller rather than given a random key that could never match again.
 */
export function gapDedupeKey(
  kind: string,
  subject: { conversationId?: string | null; contactId?: string | null }
): string | null {
  const subjectId = subject.conversationId || subject.contactId;
  if (!subjectId) return null;
  return `${kind}:${subjectId}`;
}

export interface PersistGapsArgs {
  db: SupabaseClient;
  accountId: string;
  thread: SweepThread;
  gaps: DetectedGap[];
}

export interface PersistGapsResult {
  opened: number;
  refreshed: number;
}

interface OpenGapRow {
  id: string;
  dedupe_key: string;
  occurrence_count: number;
}

/**
 * Files a thread's gaps, opening what is new and ageing what is not.
 *
 * Nothing here throws. The sweep is bookkeeping that runs behind a
 * cron; a failure to file an observation must never take down the
 * rest of the account's run, and there is no user waiting on it.
 */
export async function persistGaps(
  args: PersistGapsArgs
): Promise<PersistGapsResult> {
  const result: PersistGapsResult = { opened: 0, refreshed: 0 };
  const { db, accountId, thread } = args;
  if (!args.gaps.length) return result;

  const keyed = args.gaps
    .map((gap) => ({
      gap,
      key: gapDedupeKey(gap.kind, {
        conversationId: thread.conversationId,
        contactId: thread.contactId,
      }),
    }))
    .filter(
      (entry): entry is { gap: DetectedGap; key: string } => entry.key !== null
    );

  if (!keyed.length) return result;

  try {
    const { data: existingRows } = await db
      .from('conversation_gaps')
      .select('id, dedupe_key, occurrence_count')
      .eq('account_id', accountId)
      .eq('status', 'open')
      .in(
        'dedupe_key',
        keyed.map((e) => e.key)
      );

    const existing = new Map(
      ((existingRows as OpenGapRow[] | null) ?? []).map((row) => [
        row.dedupe_key,
        row,
      ])
    );

    const inserts: Record<string, unknown>[] = [];

    for (const { gap, key } of keyed) {
      const prior = existing.get(key);
      if (prior) {
        // The situation persists, so the row does. Evidence and
        // timestamp move to the newest sighting — a reviewer opening
        // a four-day-old gap should read the latest thing said, not
        // the sentence from Tuesday.
        const { error } = await db
          .from('conversation_gaps')
          .update({
            occurrence_count: prior.occurrence_count + 1,
            severity: gap.severity,
            summary: gap.summary,
            evidence: gap.evidence,
            suggested_action: gap.suggestedAction,
            occurred_at: gap.occurredAt,
          })
          .eq('id', prior.id)
          .eq('account_id', accountId);
        if (!error) result.refreshed += 1;
        continue;
      }

      inserts.push({
        account_id: accountId,
        contact_id: thread.contactId,
        conversation_id: thread.conversationId,
        property_id: gap.propertyId ?? thread.propertyId,
        assigned_agent_id: thread.assignedAgentId,
        channel: thread.channel,
        kind: gap.kind,
        severity: gap.severity,
        summary: gap.summary,
        evidence: gap.evidence,
        suggested_action: gap.suggestedAction,
        occurred_at: gap.occurredAt,
        dedupe_key: key,
      });
    }

    if (inserts.length) {
      // .select() because an RLS refusal returns zero rows and no
      // error, and a refused insert counted as opened would be
      // reported in a digest that links to nothing.
      const { data: written, error } = await db
        .from('conversation_gaps')
        .insert(inserts)
        .select('id');
      if (error) {
        console.error('[sweep] gap insert failed:', error);
      } else {
        result.opened += written?.length ?? 0;
      }
    }
  } catch (err) {
    console.error('[sweep] persistGaps failed:', err);
  }

  return result;
}
