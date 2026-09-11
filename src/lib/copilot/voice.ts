const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

const AUDIO_MIME_TYPES = new Set([
  'audio/aac',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/webm',
  'audio/x-m4a',
]);

export type CopilotVoiceRequest =
  | { audio: Buffer; mimeType: string }
  | { error: string; status: number };

export function readCopilotVoiceRequest(raw: unknown): CopilotVoiceRequest {
  const body = (raw ?? {}) as {
    audio?: { base64?: unknown; mimeType?: unknown };
  };
  const base64 =
    typeof body.audio?.base64 === 'string' ? body.audio.base64.trim() : '';
  const mimeType =
    typeof body.audio?.mimeType === 'string'
      ? body.audio.mimeType.split(';')[0].trim().toLocaleLowerCase()
      : '';

  if (!base64) return { error: 'Provide a voice recording.', status: 400 };
  if (!AUDIO_MIME_TYPES.has(mimeType)) {
    return { error: 'Unsupported voice recording format.', status: 415 };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { error: 'Invalid voice recording.', status: 400 };
  }
  if (base64.length * 0.75 > MAX_AUDIO_BYTES) {
    return { error: 'Voice recording is too large (max 5MB).', status: 413 };
  }

  const audio = Buffer.from(base64, 'base64');
  if (audio.length < 250) {
    return { error: 'Voice recording is too short.', status: 422 };
  }
  return { audio, mimeType };
}
