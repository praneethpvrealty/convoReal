/**
 * Pure logic for audio announcements
 * (docs/voice-agent-integration-plan.md §7). The generation job and
 * send loop live in the worker and API routes; everything here is
 * deterministic and unit-tested.
 */

export const UPDATE_CHANNELS = [
  'whatsapp_text',
  'whatsapp_audio',
  'voice_call',
] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export function isUpdateChannel(v: unknown): v is UpdateChannel {
  return (
    typeof v === 'string' && (UPDATE_CHANNELS as readonly string[]).includes(v)
  );
}

export type AnnouncementDelivery =
  | 'audio'
  | 'text'
  | 'skipped_voice_pref'
  | 'skipped_window';

/**
 * How one recipient receives an announcement. An explicit contact
 * preference always wins over the sender's default; a voice_call
 * preference is skipped here (announcements are WhatsApp messages —
 * the call path rides the campaign dispatcher). Everything free-form
 * needs an open 24-hour window, whatever the channel.
 */
export function announcementDeliveryFor(
  preference: UpdateChannel | null,
  senderDefault: 'whatsapp_audio' | 'whatsapp_text',
  windowOpen: boolean
): AnnouncementDelivery {
  if (preference === 'voice_call') return 'skipped_voice_pref';
  if (!windowOpen) return 'skipped_window';
  const channel = preference ?? senderDefault;
  return channel === 'whatsapp_text' ? 'text' : 'audio';
}

export interface AnnouncementSendCounts {
  audio: number;
  text: number;
  skipped_voice_pref: number;
  skipped_window: number;
  failed: number;
}

export function emptySendCounts(): AnnouncementSendCounts {
  return {
    audio: 0,
    text: 0,
    skipped_voice_pref: 0,
    skipped_window: 0,
    failed: 0,
  };
}

/** Merge a send run into the totals stored on the announcement row. */
export function accumulateSendCounts(
  stored: unknown,
  run: AnnouncementSendCounts
): AnnouncementSendCounts {
  const prev = (stored ?? {}) as Partial<AnnouncementSendCounts>;
  return {
    audio: (prev.audio ?? 0) + run.audio,
    text: (prev.text ?? 0) + run.text,
    skipped_voice_pref: (prev.skipped_voice_pref ?? 0) + run.skipped_voice_pref,
    skipped_window: (prev.skipped_window ?? 0) + run.skipped_window,
    failed: (prev.failed ?? 0) + run.failed,
  };
}
