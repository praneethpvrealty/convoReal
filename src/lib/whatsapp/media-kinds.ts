/**
 * What WhatsApp accepts as an outbound attachment.
 *
 * Meta enforces both of these server-side and reports a failure only
 * after the send has been accepted, so an oversized or wrong-typed file
 * lands in the thread as a delivery failure minutes later rather than
 * as a refusal the agent can act on. Checking here turns that into an
 * error at the moment of picking.
 *
 * Caps and type lists are Meta's, from the Cloud API media docs.
 */

import type { MediaKind } from '@/lib/whatsapp/meta-api';

const MIME_TO_KIND: Record<string, MediaKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',

  'video/mp4': 'video',
  'video/3gpp': 'video',

  'audio/aac': 'audio',
  'audio/mp4': 'audio',
  'audio/mpeg': 'audio',
  'audio/amr': 'audio',
  'audio/ogg': 'audio',

  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    'document',
  'application/vnd.ms-powerpoint': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'document',
  'text/plain': 'document',
};

/** Meta's per-kind ceiling, in bytes. */
export const MEDIA_SIZE_LIMITS: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

/** Only these render a caption; audio silently drops one. */
export const CAPTIONABLE_KINDS: MediaKind[] = ['image', 'video', 'document'];

/** WhatsApp caps a media caption well below a text message's 4096. */
export const MEDIA_CAPTION_LIMIT = 1024;

/**
 * The kind Meta will treat this file as, or null if it will not take it
 * at all. `audio/ogg` is the voice-note codec and is the one type a
 * recorder produces that is not otherwise obvious.
 */
export function mediaKindForMime(mimeType: string | null | undefined): MediaKind | null {
  if (!mimeType) return null;
  // Browsers and recorders append parameters ("audio/ogg; codecs=opus").
  const bare = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_TO_KIND[bare] ?? null;
}

/** Narrows caller-supplied input to a kind the dispatcher accepts. */
export function isMediaKind(value: unknown): value is MediaKind {
  return (
    value === 'image' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'document'
  );
}

export interface MediaRejection {
  error: string;
  code: 'UNSUPPORTED_MEDIA_TYPE' | 'MEDIA_TOO_LARGE';
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Why WhatsApp would refuse this file, or null if it would take it.
 * Returned to the picker so the agent hears "video over 16 MB" rather
 * than watching the send fail later.
 */
export function rejectMedia(
  mimeType: string | null | undefined,
  sizeBytes: number
): MediaRejection | null {
  const kind = mediaKindForMime(mimeType);
  if (!kind) {
    return {
      error: `WhatsApp does not accept ${mimeType || 'files of this type'}.`,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    };
  }
  const limit = MEDIA_SIZE_LIMITS[kind];
  if (sizeBytes > limit) {
    return {
      error: `WhatsApp caps ${kind} at ${megabytes(limit)} — this is ${megabytes(sizeBytes)}.`,
      code: 'MEDIA_TOO_LARGE',
    };
  }
  return null;
}

/** Caption trimmed to what Meta will render, or undefined for a kind
 *  that shows none. Silently truncating beats a rejected send. */
export function normalizeCaption(
  kind: MediaKind,
  caption: string | null | undefined
): string | undefined {
  if (!caption || !CAPTIONABLE_KINDS.includes(kind)) return undefined;
  const trimmed = caption.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MEDIA_CAPTION_LIMIT
    ? trimmed.slice(0, MEDIA_CAPTION_LIMIT)
    : trimmed;
}
