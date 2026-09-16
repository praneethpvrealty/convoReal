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
