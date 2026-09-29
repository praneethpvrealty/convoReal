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

/**
 * Whether the claim this note was queued under still stands: the row
 * is there with the clock it was queued with. A superseded claim — the
 * appointment reopened or moved, and the cron took the claim over with
 * a fresh clock (src/lib/appointments/reminder.ts) — means the note's
 * time is stale and a fresh note is on its way. Throws when the
 * database did not answer, so the caller can requeue rather than drop.
 */
async function claimStands(
  admin: SupabaseClient,
  job: ReminderAudioJob
): Promise<boolean> {
  if (!job.claimId) return true;
  const { data, error } = await admin
    .from('appointment_reminder_log')
    .select('id, created_at')
    .eq('id', job.claimId)
    .maybeSingle();
  if (error) throw new Error(`claim lookup failed: ${error.message}`);
  if (!data) return false;
  return (
    !job.claimedAt ||
    new Date(data.created_at).getTime() === new Date(job.claimedAt).getTime()
  );
}

/** The claim is checked before each send, since the appointment can
 *  be reopened or moved while a note renders. A lookup the database
 *  did not answer requeues the job a few times rather than losing the
 *  reminder; after that it sends, a stale note being the lesser harm. */
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
    return 'send';
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
  const claimFilter = (query: {
    eq: (column: string, value: string) => unknown;
  }) =>
    job.claimId
      ? query.eq('id', job.claimId)
      : (
          (
            query.eq('appointment_id', job.appointmentId) as typeof query
          ).eq('contact_id', job.contactId) as typeof query
        ).eq('reminder_type', job.reminderType);
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
          .update({ wa_message_id: result.whatsappMessageId })
      );
    }
    return;
  }
  console.error(
    `[reminder-audio] Template fallback failed for appt ${job.appointmentId}:`,
    result.error
  );
  await claimFilter(admin.from('appointment_reminder_log').delete());
  await admin
    .from('appointments')
    .update(
      job.reminderType === '1h'
        ? { reminder_1h_sent: false }
        : { reminder_morning_sent: false }
    )
    .eq('id', job.appointmentId);
}
