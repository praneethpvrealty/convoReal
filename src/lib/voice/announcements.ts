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
  | 'video_template'
  | 'skipped_voice_pref'
  | 'skipped_window';

/**
 * How one recipient receives an announcement. An explicit contact
 * preference always wins over the sender's default; a voice_call
 * preference is skipped here (announcements are WhatsApp messages —
 * the call path rides the campaign dispatcher). Everything free-form
 * needs an open 24-hour window; a closed window falls back to the
 * VIDEO-header template when the announcement has a packaged video and
 * the account has the approved template — audio-channel recipients
 * only, since the template plays the narration, not the text.
 */
export function announcementDeliveryFor(
  preference: UpdateChannel | null,
  senderDefault: 'whatsapp_audio' | 'whatsapp_text',
  windowOpen: boolean,
  videoTemplateAvailable = false
): AnnouncementDelivery {
  if (preference === 'voice_call') return 'skipped_voice_pref';
  const channel = preference ?? senderDefault;
  if (!windowOpen) {
    return channel === 'whatsapp_audio' && videoTemplateAvailable
      ? 'video_template'
      : 'skipped_window';
  }
  return channel === 'whatsapp_text' ? 'text' : 'audio';
}

export interface AnnouncementSendCounts {
  audio: number;
  text: number;
  video_template: number;
  skipped_voice_pref: number;
  skipped_window: number;
  failed: number;
}

export function emptySendCounts(): AnnouncementSendCounts {
  return {
    audio: 0,
    text: 0,
    video_template: 0,
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
    video_template: (prev.video_template ?? 0) + run.video_template,
    skipped_voice_pref: (prev.skipped_voice_pref ?? 0) + run.skipped_voice_pref,
    skipped_window: (prev.skipped_window ?? 0) + run.skipped_window,
    failed: (prev.failed ?? 0) + run.failed,
  };
}

// ------------------------------------------------------------
// Update-channel capture over WhatsApp reply buttons
// ------------------------------------------------------------

/** Reply-id prefix for the "how would you like updates?" buttons the
 *  Engine mints. Registered in control-reply-ids.ts so a tap is never
 *  mistaken for a staff member answering a lead. */
export const UPDATE_CHANNEL_REPLY_PREFIX = 'updch:';

export function updateChannelReplyId(channel: UpdateChannel): string {
  return `${UPDATE_CHANNEL_REPLY_PREFIX}${channel}`;
}

export function parseUpdateChannelReplyId(
  replyId: string
): UpdateChannel | null {
  if (!replyId.startsWith(UPDATE_CHANNEL_REPLY_PREFIX)) return null;
  const channel = replyId.slice(UPDATE_CHANNEL_REPLY_PREFIX.length);
  return isUpdateChannel(channel) ? channel : null;
}

/** The confirmation a contact gets after picking a channel. */
export function updateChannelConfirmation(channel: UpdateChannel): string {
  switch (channel) {
    case 'whatsapp_audio':
      return 'Got it — updates will come as voice notes. Reply here anytime to change this.';
    case 'voice_call':
      return 'Got it — we will call you with updates. Reply here anytime to change this.';
    default:
      return 'Got it — updates will come as text messages. Reply here anytime to change this.';
  }
}
