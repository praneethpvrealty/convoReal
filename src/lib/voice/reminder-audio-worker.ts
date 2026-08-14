import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { loadTemplateForContact } from '@/lib/whatsapp/template-language';
import { synthesizeVoiceNoteOgg } from './announcement-worker';
import { narrationLanguageFor, type ReminderAudioJob } from './reminder-audio';

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
      await admin
        .from('appointment_reminder_log')
        .update({ wa_message_id: result.whatsappMessageId })
        .eq('appointment_id', job.appointmentId)
        .eq('contact_id', job.contactId)
        .eq('reminder_type', job.reminderType);
    }
    return;
  }
  console.error(
    `[reminder-audio] Template fallback failed for appt ${job.appointmentId}:`,
    result.error
  );
  await admin
    .from('appointment_reminder_log')
    .delete()
    .eq('appointment_id', job.appointmentId)
    .eq('contact_id', job.contactId)
    .eq('reminder_type', job.reminderType);
  await admin
    .from('appointments')
    .update(
      job.reminderType === '1h'
        ? { reminder_1h_sent: false }
        : { reminder_morning_sent: false }
    )
    .eq('id', job.appointmentId);
}
