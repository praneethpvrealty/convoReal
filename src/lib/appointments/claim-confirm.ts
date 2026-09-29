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
  /** What the claim covered, so a claim released in the meantime can
   *  be put back as a confirmed one. */
  appointmentId: string;
  contactId: string | null;
  liaisonId: string | null;
  reminderType: 'morning' | '1h';
  rearmedAt: string | null;
  waMessageId: string | null;
  sentAt: string;
}

export interface ReminderClaimConfirmJob extends ClaimConfirmation {
  kind: 'reminder_claim_confirm';
  attempts?: number;
}

export const CLAIM_CONFIRM_RETRY = { attempts: 3, delayMs: 1_000 };
/** Foreign-key and check violations on the restore: the row the claim
 *  referenced no longer exists, and no retry will change that. */
const TERMINAL_RESTORE_ERRORS = new Set(['23503', '23514']);
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
  // The claim moved before this send was confirmed: the cron took it
  // over — and sent again — or a takeover's failed send released it.
  // Renewed, the row describes the later send and the earlier message
  // id is kept beside it so a reply to either still maps; released,
  // the claim is put back as a confirmed one, since the send it
  // covered did go out.
  const kept = confirmation.waMessageId
    ? await keepPriorMessageId(admin, confirmation, 'id')
    : 'no-row';
  if (kept !== 'no-row') return kept;
  const recipient = confirmation.liaisonId
    ? { liaison_id: confirmation.liaisonId }
    : { contact_id: confirmation.contactId };
  const { data: restored, error: restoreErr } = await admin
    .from('appointment_reminder_log')
    .insert({
      id: confirmation.claimId,
      account_id: confirmation.accountId,
      appointment_id: confirmation.appointmentId,
      ...recipient,
      reminder_type: confirmation.reminderType,
      rearmed_at: confirmation.rearmedAt,
      generation_known: true,
      sent_at: confirmation.sentAt,
      wa_message_id: confirmation.waMessageId,
    })
    .select('id')
    .maybeSingle();
  if (!restoreErr && restored) {
    console.warn(
      `[Reminder] claim ${confirmation.claimId} had been released before its send was confirmed; put back as confirmed`
    );
    return 'stamped';
  }
  if (restoreErr && TERMINAL_RESTORE_ERRORS.has(restoreErr.code)) {
    // The appointment, contact or liaison the claim referenced is
    // gone, and the claim with it: there is nothing left to confirm.
    console.warn(
      `[Reminder] claim ${confirmation.claimId} cannot be restored, its appointment or recipient was deleted (${restoreErr.code}); nothing left to confirm`
    );
    return 'gone';
  }
  if (restoreErr?.code !== '23505') {
    console.error(
      `[Reminder] could not restore claim ${confirmation.claimId}:`,
      restoreErr ?? 'no row'
    );
    return 'failed';
  }
  if (!confirmation.waMessageId) return 'gone';
  const keptOnNew = await keepPriorMessageId(admin, confirmation, 'recipient');
  return keptOnNew === 'no-row' ? 'failed' : keptOnNew;
}

/** Keeps the earlier send's message id beside the current one on the
 *  row that now covers the recipient — found by the claim's id, or by
 *  the recipient when the claim was re-made under a new id — through
 *  appointment_reminder_keep_prior_id, which appends so that late
 *  confirmations of several sends all keep their ids. */
async function keepPriorMessageId(
  admin: SupabaseClient,
  confirmation: ClaimConfirmation,
  by: 'id' | 'recipient'
): Promise<'gone' | 'failed' | 'no-row'> {
  const { data, error } = await admin.rpc('appointment_reminder_keep_prior_id', {
    p_account_id: confirmation.accountId,
    p_claim_id: by === 'id' ? confirmation.claimId : null,
    p_appointment_id: confirmation.appointmentId,
    p_contact_id: confirmation.contactId,
    p_liaison_id: confirmation.liaisonId,
    p_reminder_type: confirmation.reminderType,
    p_wa_message_id: confirmation.waMessageId,
  });
  if (error) {
    console.error(
      `[Reminder] could not keep the earlier message id for claim ${confirmation.claimId}:`,
      error
    );
    return 'failed';
  }
  if (!data) return 'no-row';
  console.warn(
    `[Reminder] claim ${confirmation.claimId} was renewed before its send was confirmed; the earlier message id is kept beside the new one`
  );
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
