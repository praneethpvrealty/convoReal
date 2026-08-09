// Picking an attachment, and what to call it once picked.
//
// The pickers themselves live in the composer (they need permission
// dialogs and the app's own error surface); what is here is the part
// worth being sure about — the mime type a picked asset really has, and
// the caps Meta enforces, mirrored from
// src/lib/whatsapp/media-kinds.ts in the web repo.

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document';

/** Meta's per-kind ceiling, in bytes. Mirrors MEDIA_SIZE_LIMITS. */
export const ATTACHMENT_SIZE_LIMITS: Record<AttachmentKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  amr: 'audio/amr',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
};

/**
 * The mime type to send for a picked asset.
 *
 * Android's image picker reports `application/octet-stream` for a file
 * it has not sniffed, and iOS sometimes reports nothing at all — either
 * one makes WhatsApp refuse the send. The filename is the more reliable
 * signal in those cases, so it wins whenever the reported type is
 * missing or the generic byte-stream placeholder.
 */
export function attachmentMimeType(
  reported: string | null | undefined,
  filename: string | null | undefined
): string | null {
  const bare = reported?.split(';')[0].trim().toLowerCase();
  if (bare && bare !== 'application/octet-stream') return bare;

  const ext = filename?.includes('.')
    ? filename.split('.').pop()?.toLowerCase()
    : undefined;
  return (ext && EXTENSION_MIME[ext]) || null;
}

/**
 * Which kind of bubble a picked file will become.
 *
 * The upload response says the same thing, but only once the file is
 * up — and the pending bubble has to be on screen before that, so it
 * has to be worked out from the mime type alone. Anything that is not
 * plainly an image, video or audio is a document, which is also how
 * Meta treats it.
 */
export function attachmentKind(mimeType: string | null | undefined): AttachmentKind {
  const bare = mimeType?.split(';')[0].trim().toLowerCase() ?? '';
  if (bare.startsWith('image/')) return 'image';
  if (bare.startsWith('video/')) return 'video';
  if (bare.startsWith('audio/')) return 'audio';
  return 'document';
}

/** A filename WhatsApp will show, derived from the picker's URI when
 *  the asset has no name of its own (the camera roll rarely does). */
export function attachmentFilename(
  name: string | null | undefined,
  uri: string,
  mimeType: string | null
): string {
  const given = name?.trim();
  if (given) return given;

  const fromUri = uri.split('/').pop()?.split('?')[0];
  if (fromUri && fromUri.includes('.')) return fromUri;

  const ext = mimeType?.split('/')[1]?.split('+')[0] || 'bin';
  return `attachment.${ext}`;
}

/** Human size for the caption under a document bubble. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** mm:ss for a voice note's length. */
export function formatDuration(millis: number | null | undefined): string {
  const total = Math.max(0, Math.floor((millis ?? 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
