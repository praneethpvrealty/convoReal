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

/** Hands the reminder back to the cron: the claim is released and the
 *  appointment flag re-opened, pinned to the generation this note was
 *  rendered from so a newer one is never touched. The next sweep then
 *  reads the appointment afresh and sends the template itself. True
 *  only when both writes were confirmed; the client reports a failed
 *  write as a result, not a throw, so each is read. */
async function handBackToCron(
  admin: SupabaseClient,
  job: ReminderAudioJob
): Promise<boolean> {
  const released = (await claimFilter(
    admin.from('appointment_reminder_log').delete(),
    job
  )) as { error: { message: string } | null };
  if (released.error) {
    console.error(
      `[reminder-audio] Could not release claim ${job.claimId} for appt ${job.appointmentId}:`,
      released.error.message
    );
    return false;
  }
  const reopen = admin
    .from('appointments')
    .update(
      job.reminderType === '1h'
        ? { reminder_1h_sent: false }
        : { reminder_morning_sent: false }
    )
    .eq('id', job.appointmentId)
    .eq('account_id', job.accountId);
  const reopened = (await (job.rearmedAt === undefined
    ? reopen
    : job.rearmedAt
      ? reopen.eq('reminders_rearmed_at', job.rearmedAt)
      : reopen.is('reminders_rearmed_at', null))) as {
    error: { message: string } | null;
  };
  if (reopened.error) {
    console.error(
      `[reminder-audio] Could not re-open the ${job.reminderType} reminder for appt ${job.appointmentId}:`,
      reopened.error.message
    );
    return false;
  }
  return true;
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
  if (!job.claimId) return true;
  const { data, error } = await admin
    .from('appointment_reminder_log')
    .select('id, created_at, appointment:appointments(reminders_rearmed_at)')
    .eq('id', job.claimId)
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
    // The note is never sent unverified. Until the hand-back is
    // confirmed the job is kept — requeued past the retry cap, since
    // dropping it here would leave the claim and flag saying the
    // reminder was delivered.
    let handedBack = false;
    try {
      handedBack = await handBackToCron(admin, job);
    } catch (handBackErr) {
      console.error(
        `[reminder-audio] Hand-back threw for appt ${job.appointmentId}:`,
        handBackErr instanceof Error ? handBackErr.message : handBackErr
      );
    }
    if (handedBack) return 'drop';
    if (await enqueueReminderAudioJob({ ...job, attempts })) return 'requeued';
    console.error(
      `[reminder-audio] Could not hand the ${job.reminderType} reminder for appt ${job.appointmentId} back to the cron or requeue it`
    );
    return 'drop';
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
    if (result.whatsappMessageId) {
      await claimFilter(
        admin
          .from('appointment_reminder_log')
          .update({ wa_message_id: result.whatsappMessageId }),
        job
      );
    }
    return;
  }
  console.error(
    `[reminder-audio] Template fallback failed for appt ${job.appointmentId}:`,
    result.error
  );
  if (!(await handBackToCron(admin, job))) {
    console.error(
      `[reminder-audio] The ${job.reminderType} reminder for appt ${job.appointmentId} is still marked covered after a failed send`
    );
  }
}
