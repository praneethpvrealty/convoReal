import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { loadTemplateForContact } from '@/lib/whatsapp/template-language';
import type { SupabaseClient } from '@supabase/supabase-js';
import { synthesizeVoiceNoteOgg } from './announcement-worker';
import {
  enqueueReminderAudioJob,
  narrationLanguageFor,
  parkReminderAudioJob,
  type ReminderAudioJob,
} from './reminder-audio';

const CLAIM_LOOKUP_ATTEMPTS = 3;

type ClaimQuery = {
  eq: (column: string, value: string) => unknown;
};

/** Writes touch the claim as this note holds it — the account, the
 *  row and the clock it was queued under — so a claim the cron has
 *  since renewed for a fresh note is never overwritten or released. */
function claimFilter<T extends ClaimQuery>(query: T, job: ReminderAudioJob) {
  const own = query.eq('account_id', job.accountId) as T;
  if (!job.claimId) {
    return (
      (own.eq('appointment_id', job.appointmentId) as T).eq(
        'contact_id',
        job.contactId
      ) as T
    ).eq('reminder_type', job.reminderType);
  }
  const byId = own.eq('id', job.claimId) as T;
  return job.claimedAt ? byId.eq('created_at', job.claimedAt) : byId;
}

/** Hands the reminder back to the cron in one transaction
 *  (appointment_reminder_hand_back): the claim is released and the
 *  appointment flag re-opened together, pinned to the generation this
 *  note was rendered from so a newer one is never touched. The next
 *  sweep then reads the appointment afresh and sends the template
 *  itself. True only when the database confirmed it. */
async function handBackToCron(
  admin: SupabaseClient,
  job: ReminderAudioJob
): Promise<boolean> {
  const { error } = await admin.rpc('appointment_reminder_hand_back', {
    p_account_id: job.accountId,
    p_appointment_id: job.appointmentId,
    p_contact_id: job.contactId,
    p_reminder_type: job.reminderType,
    p_claim_id: job.claimId ?? null,
    p_claimed_at: job.claimedAt ?? null,
    p_rearmed_known: job.rearmedAt !== undefined,
    p_rearmed_at: job.rearmedAt ?? null,
  });
  if (error) {
    console.error(
      `[reminder-audio] Could not hand the ${job.reminderType} reminder for appt ${job.appointmentId} back to the cron:`,
      error.message
    );
    return false;
  }
  return true;
}

/** The pause between rounds while a note is held for a store to
 *  confirm it. Exported so tests can shorten the wait. */
export const RETAIN = { delayMs: 5_000 };

/** Keeps the note until its reminder is persisted somewhere: handed
 *  back to the cron (the database confirmed it), requeued, or parked in
 *  the dead-letter list. The worker already popped it, and its claim
 *  and flag say it was delivered, so nothing short of a store's
 *  confirmation lets go of it: every store is retried with a pause
 *  between rounds for as long as it takes — a database and a Redis
 *  outage at once is what this is for — with the payload logged whole
 *  each minute so an operator can replay it by hand if the worker is
 *  restarted first. A note the worker cannot verify at all (queued
 *  before generations were recorded) is never requeued, since it would
 *  come straight back. */
async function retainUntilPersisted(
  admin: SupabaseClient,
  job: ReminderAudioJob,
  attempts: number,
  requeue = true
): Promise<'drop' | 'requeued'> {
  for (let round = 1; ; round++) {
    if (await handBackToCron(admin, job).catch(() => false)) return 'drop';
    if (requeue && (await enqueueReminderAudioJob({ ...job, attempts }))) {
      return 'requeued';
    }
    if (await parkReminderAudioJob(job)) {
      console.error(
        `[reminder-audio] Parked the ${job.reminderType} reminder for appt ${job.appointmentId} in the dead-letter list`
      );
      return 'drop';
    }
    if (round % 12 === 0) {
      console.error(
        `[reminder-audio] Still holding the ${job.reminderType} reminder for appt ${job.appointmentId} after ${round} rounds; payload for replay:`,
        JSON.stringify(job)
      );
    }
    await new Promise((resolve) => setTimeout(resolve, RETAIN.delayMs));
  }
}

/** A note queued before claims and generations were recorded carries
 *  nothing the appointment can be checked against. */
function isLegacy(job: ReminderAudioJob): boolean {
  return !job.claimId || job.rearmedAt === undefined;
}

/**
 * Whether the claim this note was queued under still stands: the row
 * is there with the clock it was queued with, and the appointment's
 * reminders_rearmed_at is what the cron read when it rendered the
 * note. A re-arm (reopened or moved through PUT /api/appointments/[id])
 * stamps that column at once — whether before or after the sweep that
 * queued the note — and the cron takes the claim over with a fresh
 * clock on its next sweep; either sign means the note's time is stale
 * and a fresh note is on its way. Throws when the database did not answer, so the
 * caller can requeue rather than drop.
 */
async function claimStands(
  admin: SupabaseClient,
  job: ReminderAudioJob
): Promise<boolean> {
  const { data, error } = await admin
    .from('appointment_reminder_log')
    .select('id, created_at, appointment:appointments(reminders_rearmed_at)')
    .eq('id', job.claimId!)
    .eq('account_id', job.accountId)
    .maybeSingle();
  if (error) throw new Error(`claim lookup failed: ${error.message}`);
  if (!data) return false;
  const claimedAt = new Date(data.created_at).getTime();
  if (job.claimedAt && claimedAt !== new Date(job.claimedAt).getTime()) {
    return false;
  }
  const appointment = (
    Array.isArray(data.appointment) ? data.appointment[0] : data.appointment
  ) as { reminders_rearmed_at: string | null } | null | undefined;
  const rearmedAt = appointment?.reminders_rearmed_at ?? null;
  if (job.rearmedAt !== undefined) {
    return sameInstant(rearmedAt, job.rearmedAt);
  }
  return !rearmedAt || claimedAt >= new Date(rearmedAt).getTime();
}

function sameInstant(a: string | null, b: string | null) {
  if (!a || !b) return !a && !b;
  return new Date(a).getTime() === new Date(b).getTime();
}

/** The claim is checked before each send, since the appointment can
 *  be reopened or moved while a note renders. A lookup the database
 *  did not answer requeues the job a few times; when it still cannot
 *  be established that the note is current, the note is never sent —
 *  the reminder goes back to the cron instead, which reads the
 *  appointment afresh on its next sweep. */
async function claimGate(
  admin: SupabaseClient,
  job: ReminderAudioJob
): Promise<'send' | 'drop' | 'requeued'> {
  // A note from before generations were recorded cannot be verified
  // against the appointment, so it is never sent: the cron gets the
  // reminder back and sends the template from a fresh read.
  if (isLegacy(job)) {
    console.log(
      `[reminder-audio] Handing the ${job.reminderType} reminder for appt ${job.appointmentId} back to the cron: queued without a generation`
    );
    return retainUntilPersisted(admin, job, job.attempts ?? 0, false);
  }
  try {
    if (await claimStands(admin, job)) return 'send';
    console.log(
      `[reminder-audio] Claim ${job.claimId} for appt ${job.appointmentId} was superseded — dropping the queued ${job.reminderType} note`
    );
    return 'drop';
  } catch (err) {
    const attempts = (job.attempts ?? 0) + 1;
    console.error(
      `[reminder-audio] Could not read claim ${job.claimId} for appt ${job.appointmentId} (attempt ${attempts}):`,
      err instanceof Error ? err.message : err
    );
    if (
      attempts < CLAIM_LOOKUP_ATTEMPTS &&
      (await enqueueReminderAudioJob({ ...job, attempts }))
    ) {
      return 'requeued';
    }
    // The note is never sent unverified, and never dropped either
    // while the claim and flag would still say it was delivered: it is
    // held until the cron has it back or a queue has it.
    return retainUntilPersisted(admin, job, attempts);
  }
}

/**
 * Renders one reminder to a voice note and sends it — queued by the
 * reminder cron for contacts who chose audio updates, processed here
 * because Sarvam TTS and ffmpeg only run on the queue worker.
 *
 * The reminder must land regardless of how this job fares: any
 * failure (credits, render, media send) falls back to the exact
 * template send the cron would have made, with the render charge
 * refunded. Only when even the template fails does the job release
 * the recipient's claim and re-open the appointment flag, handing
 * the retry back to the next cron tick.
 */
export async function processReminderAudioJob(
  job: ReminderAudioJob
): Promise<void> {
  const admin = supabaseAdmin();
  const cost = AI_FEATURE_COSTS.reminder_audio;

  if ((await claimGate(admin, job)) !== 'send') return;

  // One lookup serves both paths: the resolved language drives the
  // TTS voice, the row drives the template fallback variant.
  const { template: langTemplate, language } = await loadTemplateForContact(
    admin,
    {
      accountId: job.accountId,
      contactId: job.contactId,
      names: [job.fallback.templateName],
    }
  );

  let audioUrl: string | null = null;
  let charged = false;
  const burn = await burnCredits(job.accountId, 'reminder_audio', cost, {
    retryKey: `reminder-audio:${job.appointmentId}:${job.contactId}:${job.reminderType}`,
  });
  if (burn.success) {
    charged = true;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reminder-audio-'));
    try {
      const ogg = await synthesizeVoiceNoteOgg(
        job.spokenText,
        narrationLanguageFor(language),
        workDir
      );
      const storagePath = `${job.accountId}/reminders/${job.appointmentId}-${job.contactId}-${job.reminderType}.ogg`;
      const { error: upErr } = await admin.storage
        .from('announcements')
        .upload(storagePath, fs.readFileSync(ogg), {
          contentType: 'audio/ogg',
          upsert: true,
        });
      if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);
      audioUrl = admin.storage.from('announcements').getPublicUrl(storagePath)
        .data.publicUrl;
    } catch (err) {
      console.error(
        `[reminder-audio] Render failed for appt ${job.appointmentId} contact ${job.contactId}:`,
        err instanceof Error ? err.message : err
      );
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  } else {
    console.warn(
      `[reminder-audio] Insufficient credits for account ${job.accountId} — sending template instead.`
    );
  }

  if (audioUrl) {
    if ((await claimGate(admin, job)) !== 'send') {
      if (charged) {
        await refundCredits(job.accountId, 'reminder_audio', cost, {
          description: `reminder audio refund (${job.appointmentId}/${job.contactId}/${job.reminderType})`,
        });
      }
      return;
    }
    const sent = await sendWhatsAppMessageAndPersist({
      accountId: job.accountId,
      userId: job.userId,
      contactId: job.contactId,
      kind: 'media',
      mediaKind: 'audio',
      mediaLink: audioUrl,
      text: job.spokenText,
      senderType: 'agent',
      customDbClient: admin,
    });
    if (sent.success) {
      console.log(
        `[reminder-audio] Sent ${job.reminderType} reminder note for appt ${job.appointmentId} to contact ${job.contactId}`
      );
      await claimFilter(
        admin
          .from('appointment_reminder_log')
          .update({ sent_at: new Date().toISOString() }),
        job
      );
      return;
    }
    console.error(
      `[reminder-audio] Voice-note send failed for appt ${job.appointmentId}:`,
      sent.error
    );
  }
  if (charged) {
    await refundCredits(job.accountId, 'reminder_audio', cost, {
      description: `reminder audio refund (${job.appointmentId}/${job.contactId}/${job.reminderType})`,
    });
  }

  if ((await claimGate(admin, job)) !== 'send') return;
  const result = await sendWhatsAppMessageAndPersist({
    accountId: job.accountId,
    userId: job.userId,
    contactId: job.contactId,
    kind: 'template',
    senderType: 'agent',
    templateName: job.fallback.templateName,
    templateLanguage: langTemplate?.language || 'en_US',
    templateParams: job.fallback.templateParams,
    text: job.fallback.bodyText,
    customDbClient: admin,
  });
  if (result.success) {
    console.log(
      `[reminder-audio] Fell back to template for appt ${job.appointmentId} contact ${job.contactId}`
    );
    await claimFilter(
      admin.from('appointment_reminder_log').update({
        sent_at: new Date().toISOString(),
        wa_message_id: result.whatsappMessageId ?? null,
      }),
      job
    );
    return;
  }
  console.error(
    `[reminder-audio] Template fallback failed for appt ${job.appointmentId}:`,
    result.error
  );
  if (!(await handBackToCron(admin, job))) {
    await retainUntilPersisted(admin, job, job.attempts ?? 0);
  }
}
