import type { Plan } from '@/lib/billing/types';

export const PROPERTY_VIDEO_STARTER_MAX_BYTES = 16 * 1024 * 1024;
export const PROPERTY_VIDEO_PREMIUM_MAX_BYTES = 100 * 1024 * 1024;
export const PROPERTY_VIDEO_MAX_BYTES = PROPERTY_VIDEO_STARTER_MAX_BYTES;
export const PROPERTY_VIDEO_MIME_TYPE = 'video/mp4';

export function propertyVideoMaxBytes(plan: Plan): number {
  return plan === 'starter'
    ? PROPERTY_VIDEO_STARTER_MAX_BYTES
    : PROPERTY_VIDEO_PREMIUM_MAX_BYTES;
}

export function propertyVideoMaxMegabytes(maxBytes: number): number {
  return Math.round(maxBytes / (1024 * 1024));
}

export function rejectPropertyVideoPreflight(
  mimeType: string | null | undefined,
  size: number
): PropertyVideoRejection | null {
  return rejectPropertyVideo(mimeType, size, PROPERTY_VIDEO_PREMIUM_MAX_BYTES);
}

export type PropertyVideoRejection = {
  code: 'UNSUPPORTED_VIDEO_TYPE' | 'VIDEO_TOO_LARGE';
  error: string;
  status: 413 | 415;
};

export function rejectPropertyVideo(
  mimeType: string | null | undefined,
  size: number,
  maxBytes = PROPERTY_VIDEO_STARTER_MAX_BYTES
): PropertyVideoRejection | null {
  const bareType = mimeType?.split(';')[0].trim().toLowerCase();
  if (bareType !== PROPERTY_VIDEO_MIME_TYPE) {
    return {
      code: 'UNSUPPORTED_VIDEO_TYPE',
      error: 'Only MP4 walkthrough videos are supported.',
      status: 415,
    };
  }
  if (size > maxBytes) {
    return {
      code: 'VIDEO_TOO_LARGE',
      error: `Video is too large. Maximum size is ${propertyVideoMaxMegabytes(maxBytes)} MB.`,
      status: 413,
    };
  }
  return null;
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

export function walkthroughTooLargeReply(
  bytes: number,
  maxBytes: number
): string {
  return (
    `⚠️ *Video too large.* This one is ${megabytes(bytes)} MB and walkthroughs up to ` +
    `${propertyVideoMaxMegabytes(maxBytes)} MB are accepted on your plan. ` +
    `Please send a shorter or compressed MP4.`
  );
}

export function isStorageTooLargeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /maximum allowed size|payload too large|entitytoolarge/i.test(message);
}

export function walkthroughUploadFailedReply(
  err: unknown,
  bytes: number,
  maxBytes: number
): string {
  if (isStorageTooLargeError(err)) {
    return (
      `❌ *Video too large to store.* This one is ${megabytes(bytes)} MB; ` +
      `walkthroughs up to ${propertyVideoMaxMegabytes(maxBytes)} MB are accepted on your plan. ` +
      `Please send a shorter or compressed MP4.`
    );
  }
  return (
    `❌ *Failed to upload video.* Please send the walkthrough again as an MP4 ` +
    `(up to ${propertyVideoMaxMegabytes(maxBytes)} MB).`
  );
}

export function walkthroughDroppedNote(
  bytes: number | null,
  maxBytes: number
): string {
  if (!bytes) return '';
  return (
    `\n\n_🎬 The ${megabytes(bytes)} MB video was too large to store ` +
    `(limit ${propertyVideoMaxMegabytes(maxBytes)} MB), so the listing has no walkthrough yet. ` +
    `Send a shorter or compressed MP4 to attach one._`
  );
}
