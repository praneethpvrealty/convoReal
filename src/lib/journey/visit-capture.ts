/**
 * The scheduler's side of the journey.
 *
 * A buyer who answers "I want to visit on Sunday" is consumed by the
 * WhatsApp scheduler before the check-in handler sees the message, so
 * the reply used to leave no trace on the journey; and a booked site
 * visit never moved the branch, so Site Visit Scheduled sat empty while
 * the calendar filled up. Both are recorded here: the words as a
 * client_response event on the contact×property branch (created at
 * the first stage when the pair was never captured), and the booking
 * as an advance to the account's site-visit stage — forward only, so a
 * buyer already negotiating is not pulled back.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ensureJourneyItem,
  loadJourneyStages,
  type JourneyItemRow,
  type JourneyStageRow,
} from '@/lib/journey/capture-server';
import { moveJourneyItem } from '@/lib/journey/move';

const RESPONSE_REASON_LIMIT = 280;

export const VISIT_REQUEST_CAPTURE_REASON = 'Captured from visit request';
export const SITE_VISIT_BOOKED_REASON = 'Site visit booked from WhatsApp';

/** The stage a booked visit advances to: the first mirrored stage whose
 *  name says site visit, or nothing when the account renamed it away. */
export function pickSiteVisitStage<
  T extends { name: string; position: number },
>(stages: T[]): T | null {
  return (
    [...stages]
      .sort((a, b) => a.position - b.position)
      .find((stage) => /site[\s-]*visit/i.test(stage.name)) ?? null
  );
}

/** A booking advances a branch, never retreats it. */
export function shouldAdvanceToSiteVisit(
  current: { position: number } | null | undefined,
  target: { position: number }
): boolean {
  if (!current) return true;
  return current.position < target.position;
}

export interface VisitJourneyArgs {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  propertyId: string;
  /** What the buyer typed. */
  text: string;
}

/** Log the buyer's visit words on their journey branch, capturing the
 *  pair when it was never on the journey. Returns the branch. */
export async function recordVisitRequestOnJourney(
  args: VisitJourneyArgs
): Promise<JourneyItemRow | null> {
  const { db, accountId, userId, contactId, propertyId } = args;
  const item = await ensureJourneyItem(db, {
    accountId,
    userId,
    contactId,
    propertyId,
    source: 'chat_import',
    hidden: false,
    reason: VISIT_REQUEST_CAPTURE_REASON,
  });
  if (!item) return null;

  const reason = args.text.trim().slice(0, RESPONSE_REASON_LIMIT);
  if (reason) {
    const { error } = await db.from('journey_events').insert({
      account_id: accountId,
      item_id: item.id,
      event_type: 'client_response',
      reason,
    });
    if (error)
      console.error('[journey/visit] response event failed:', error.message);
    await db
      .from('journey_items')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('account_id', accountId);
  }
  return item;
}

export type SiteVisitAdvanceOutcome =
  'advanced' | 'already_past' | 'no_stage' | 'no_item' | 'failed';

/** Move the branch to the site-visit stage once a visit is on the
 *  calendar. Goes through the same move as the board so a deal on the
 *  default pipeline follows. */
export async function advanceJourneyToSiteVisit(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  item: JourneyItemRow;
  stages?: JourneyStageRow[];
}): Promise<SiteVisitAdvanceOutcome> {
  const { db, accountId, userId, item } = args;
  const stages = args.stages ?? (await loadJourneyStages(db, accountId));
  const target = pickSiteVisitStage(stages);
  if (!target) return 'no_stage';
  const current = stages.find((stage) => stage.id === item.stage_id) ?? null;
  if (!shouldAdvanceToSiteVisit(current, target)) return 'already_past';

  const result = await moveJourneyItem(
    { supabase: db, accountId, userId },
    {
      itemId: item.id,
      stageId: target.id,
      eventType: 'advanced',
      brokerage: null,
      requireBrokerage: false,
      reason: SITE_VISIT_BOOKED_REASON,
      source: 'system',
    }
  );
  if (!result.ok) {
    console.error('[journey/visit] site-visit advance failed:', result.error);
    return result.status === 404 ? 'no_item' : 'failed';
  }
  return 'advanced';
}

/** The whole hand-off after a booking: the words on the branch, then
 *  the advance. Best-effort — a journey failure never fails a booking
 *  the calendar already holds. */
export async function recordSiteVisitBooked(
  args: VisitJourneyArgs
): Promise<SiteVisitAdvanceOutcome> {
  try {
    const item = await recordVisitRequestOnJourney(args);
    if (!item) return 'no_item';
    return await advanceJourneyToSiteVisit({
      db: args.db,
      accountId: args.accountId,
      userId: args.userId,
      item,
    });
  } catch (err) {
    console.error('[journey/visit] booking hand-off threw:', err);
    return 'failed';
  }
}
