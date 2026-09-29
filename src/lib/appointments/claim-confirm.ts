/**
 * Confirming a reminder claim's send.
 *
 * A delivery claim in appointment_reminder_log is provisional until
 * sent_at is stamped on it (src/lib/appointments/reminder.ts): left
 * unstamped, the cron's grace period would retry a reminder that was
 * in fact delivered, and the reply webhook would have no message id to
 * map a button tap by. The message has already gone by the time the
 * stamp is written, so the stamp must land eventually whatever the
 * database is doing right now: a few in-process tries, then the queue
 * worker carries it as a job of its own and keeps trying.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { enqueueReminderClaimConfirm } from '@/lib/voice/reminder-audio';

export interface ClaimConfirmation {
  accountId: string;
  claimId: string;
  /** The claim's clock as the sender held it; a claim the cron has
   *  since renewed for a fresh send is never stamped from here. */
  claimedAt: string | null;
  waMessageId: string | null;
  sentAt: string;
}

export interface ReminderClaimConfirmJob extends ClaimConfirmation {
  kind: 'reminder_claim_confirm';
  attempts?: number;
}

export const CLAIM_CONFIRM_RETRY = { attempts: 3, delayMs: 1_000 };
/** The pause between the queue worker's rounds while a confirmation is
 *  held for the database to take it. Exported so tests can shorten it. */
export const CLAIM_CONFIRM_HOLD = { delayMs: 5_000 };

export async function stampClaimSent(
  admin: SupabaseClient,
  confirmation: ClaimConfirmation
): Promise<'stamped' | 'gone' | 'failed'> {
  let query = admin
    .from('appointment_reminder_log')
    .update({
      sent_at: confirmation.sentAt,
      wa_message_id: confirmation.waMessageId,
    })
    .eq('account_id', confirmation.accountId)
    .eq('id', confirmation.claimId);
  if (confirmation.claimedAt) {
    query = query.eq('created_at', confirmation.claimedAt);
  }
  const { data, error } = await query.select('id').maybeSingle();
  if (error) {
    console.error(
      `[Reminder] claim confirmation failed for ${confirmation.claimId}:`,
      error
    );
    return 'failed';
  }
  if (data) return 'stamped';
  // The cron took the claim over — and sent again — before this send
  // was confirmed. The row now describes the later send; the earlier
  // message id is kept beside it so a reply to either still maps.
  console.warn(
    `[Reminder] claim ${confirmation.claimId} was renewed before its send was confirmed; keeping the earlier message id beside the new one`
  );
  if (!confirmation.waMessageId) return 'gone';
  const { error: priorErr } = await admin
    .from('appointment_reminder_log')
    .update({ prior_wa_message_id: confirmation.waMessageId })
    .eq('account_id', confirmation.accountId)
    .eq('id', confirmation.claimId);
  if (priorErr) {
    console.error(
      `[Reminder] could not keep the earlier message id on claim ${confirmation.claimId}:`,
      priorErr
    );
    return 'failed';
  }
  return 'gone';
}

/**
 * Lands the stamp, or hands it to the queue worker to land. The stamp
 * is tried a few times, then the queue; when both refuse, the
 * confirmation is held in process — both tried again after each pause
 * — for as long as the caller can wait (`holdMs`: a cron function has
 * seconds, the queue worker has forever). True when the database or
 * the queue took it; false only once the hold ran out with neither
 * taking it, in which case the confirmation is logged whole for
 * replay and the caller knows the send is on record nowhere.
 */
export async function confirmClaimSent(
  admin: SupabaseClient,
  confirmation: ClaimConfirmation,
  holdMs = 0
): Promise<boolean> {
  const deadline = Date.now() + holdMs;
  for (let attempt = 1; attempt <= CLAIM_CONFIRM_RETRY.attempts; attempt++) {
    if ((await stampClaimSent(admin, confirmation)) !== 'failed') return true;
    if (attempt < CLAIM_CONFIRM_RETRY.attempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, CLAIM_CONFIRM_RETRY.delayMs)
      );
    }
  }
  for (;;) {
    if (
      await enqueueReminderClaimConfirm({
        kind: 'reminder_claim_confirm',
        ...confirmation,
      })
    ) {
      console.error(
        `[Reminder] claim ${confirmation.claimId} confirmation handed to the queue worker`
      );
      return true;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) =>
      setTimeout(resolve, CLAIM_CONFIRM_HOLD.delayMs)
    );
    if ((await stampClaimSent(admin, confirmation)) !== 'failed') return true;
  }
  console.error(
    `[Reminder] Could not confirm claim ${confirmation.claimId} anywhere; confirmation for replay:`,
    JSON.stringify(confirmation)
  );
  return false;
}

/** Queue worker: a confirmation the sender could not land. Held —
 *  stamp, else requeue after a pause — until the database takes it. */
export async function processReminderClaimConfirmJob(
  job: ReminderClaimConfirmJob
): Promise<void> {
  const admin = supabaseAdmin();
  for (let round = 1; ; round++) {
    if ((await stampClaimSent(admin, job)) !== 'failed') return;
    await new Promise((resolve) =>
      setTimeout(resolve, CLAIM_CONFIRM_HOLD.delayMs)
    );
    if (
      await enqueueReminderClaimConfirm({
        ...job,
        attempts: (job.attempts ?? 0) + 1,
      })
    ) {
      return;
    }
    if (round % 12 === 0) {
      console.error(
        `[Reminder] Still holding the confirmation for claim ${job.claimId} after ${round} rounds; payload for replay:`,
        JSON.stringify(job)
      );
    }
  }
}
