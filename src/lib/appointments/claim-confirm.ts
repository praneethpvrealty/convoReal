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
  if (!data) {
    console.warn(
      `[Reminder] claim ${confirmation.claimId} was renewed before its send was confirmed; the renewing sweep owns it now`
    );
    return 'gone';
  }
  return 'stamped';
}

/**
 * Lands the stamp, or hands it to the queue worker to land. True when
 * either took it; false only when neither the database nor the queue
 * would, in which case the confirmation is logged whole for replay.
 */
export async function confirmClaimSent(
  admin: SupabaseClient,
  confirmation: ClaimConfirmation
): Promise<boolean> {
  for (let attempt = 1; attempt <= CLAIM_CONFIRM_RETRY.attempts; attempt++) {
    if ((await stampClaimSent(admin, confirmation)) !== 'failed') return true;
    if (attempt < CLAIM_CONFIRM_RETRY.attempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, CLAIM_CONFIRM_RETRY.delayMs)
      );
    }
  }
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
