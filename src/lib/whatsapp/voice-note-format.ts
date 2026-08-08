/**
 * Which container a browser voice note is recorded in.
 *
 * MediaRecorder's default is whatever the browser prefers, and on
 * Chrome and Edge that is `audio/webm` — a container WhatsApp does not
 * accept. An unconstrained recorder therefore produces a file the
 * upload route refuses with UNSUPPORTED_MEDIA_TYPE on the majority
 * browser, after the agent has already spoken.
 *
 * So the type is chosen up front from the list Meta takes (Cloud API
 * media docs), and a browser that supports none of them is told before
 * the microphone opens rather than after.
 */

/** Meta-accepted recording containers, best first. */
export const VOICE_NOTE_MIME_PREFERENCE = [
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
];

const EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
};

/**
 * The first preferred type this browser can record, or null when it can
 * record none of them.
 */
export function pickVoiceNoteMime(
  isSupported: (mimeType: string) => boolean
): string | null {
  return VOICE_NOTE_MIME_PREFERENCE.find((type) => isSupported(type)) ?? null;
}

/** Extension matching the container, so the file Meta fetches is named
 *  for what it actually is. */
export function voiceNoteFilename(mimeType: string, stamp: number): string {
  const bare = mimeType.split(';')[0].trim().toLowerCase();
  return `voice-${stamp}.${EXTENSIONS[bare] ?? 'ogg'}`;
}
