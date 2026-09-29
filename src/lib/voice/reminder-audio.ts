import Redis from 'ioredis';
import type { LanguageCode } from '@/lib/languages';
import type { NarrationLanguage } from '@/lib/video/listing-video';

/**
 * Appointment reminders as WhatsApp voice notes — the whatsapp_audio
 * half of preferred_update_channel, closing Phase D.
 *
 * Every reminder is unique text, so unlike announcements there is no
 * pre-rendered note to reuse: the reminder cron enqueues one TTS job
 * per recipient and the queue worker (the only place Sarvam and
 * ffmpeg run) renders and sends it. Voice notes are free-form
 * messages, so the cron only queues when the contact's 24-hour
 * window is open; everyone else stays on the template exactly as
 * before. The job carries the template fallback so the worker can
 * still land the reminder when rendering or the media send fails.
 */

export interface ReminderAudioJob {
  kind: 'reminder_audio';
  accountId: string;
  appointmentId: string;
  contactId: string;
  /** The appointment_reminder_log row this send holds, and its clock
   *  when queued. Reopening or rescheduling supersedes the claim — the
   *  cron takes it over with a fresh clock — and a note queued under
   *  the old one is dropped rather than sent with the old time. */
  claimId?: string | null;
  claimedAt?: string | null;
  /** The appointment's reminders_rearmed_at as the cron read it when it
   *  rendered this note; a different value now means the note's time
   *  is stale. */
  rearmedAt?: string | null;
  /** Requeues so far after the claim could not be read. */
  attempts?: number;
  userId: string | null;
  reminderType: 'morning' | '1h';
  spokenText: string;
  fallback: {
    templateName: string;
    templateParams: string[];
    bodyText: string;
  };
}

/**
 * What the voice note says. Mirrors the reminder template wording the
 * contact would otherwise read, minus the "tap a button below" close —
 * a voice note carries no buttons, so it invites a reply instead.
 */
export function reminderSpokenText(args: {
  clientName: string;
  brandName: string;
  title: string;
  formattedTime: string;
  locationText: string;
  agenda: string | null;
  isSiteVisit: boolean;
}): string {
  const what = args.isSiteVisit
    ? `about your scheduled property visit for ${args.title}`
    : `that you have a scheduled meeting: ${args.title}`;
  const agendaPart = args.agenda
    ? ` Agenda for the ${args.isSiteVisit ? 'visit' : 'meeting'}: ${args.agenda}.`
    : '';
  return `Hi ${args.clientName}, this is a friendly reminder from ${args.brandName} ${what} on ${args.formattedTime}. Location: ${args.locationText}.${agendaPart} Reply here if you need any changes.`;
}

/** The Sarvam narration code for a conversation language — every
 *  SUPPORTED_LANGUAGES entry has a bulbul voice. */
const NARRATION_FOR_LANGUAGE: Record<LanguageCode, NarrationLanguage> = {
  en: 'en-IN',
  hi: 'hi-IN',
  kn: 'kn-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  ml: 'ml-IN',
  mr: 'mr-IN',
};

export function narrationLanguageFor(code: LanguageCode): NarrationLanguage {
  return NARRATION_FOR_LANGUAGE[code];
}

const REMINDER_AUDIO_QUEUE = 'listing-videos';
/** Notes the worker could neither verify, hand back nor requeue wait
 *  here rather than vanish; replay one with
 *  `LMOVE listing-videos-dlq listing-videos LEFT RIGHT` once the
 *  outage is over. */
export const REMINDER_AUDIO_DLQ = 'listing-videos-dlq';

/** False when Redis is unconfigured or unreachable — the caller sends
 *  the template instead, so a queue outage never drops a reminder. */
export async function enqueueReminderAudioJob(
  job: ReminderAudioJob
): Promise<boolean> {
  return pushReminderAudioJob(REMINDER_AUDIO_QUEUE, job);
}

export async function parkReminderAudioJob(
  job: ReminderAudioJob
): Promise<boolean> {
  return pushReminderAudioJob(REMINDER_AUDIO_DLQ, job);
}

async function pushReminderAudioJob(
  list: string,
  job: ReminderAudioJob
): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return false;
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    await redis.rpush(list, JSON.stringify(job));
    return true;
  } catch (err) {
    console.error('[reminder-audio] enqueue failed:', err);
    return false;
  } finally {
    redis.disconnect();
  }
}
