export const PROPERTY_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
export const PROPERTY_VIDEO_MIME_TYPE = 'video/mp4';

export type PropertyVideoRejection = {
  code: 'UNSUPPORTED_VIDEO_TYPE' | 'VIDEO_TOO_LARGE';
  error: string;
  status: 413 | 415;
};

export function rejectPropertyVideo(
  mimeType: string | null | undefined,
  size: number
): PropertyVideoRejection | null {
  const bareType = mimeType?.split(';')[0].trim().toLowerCase();
  if (bareType !== PROPERTY_VIDEO_MIME_TYPE) {
    return {
      code: 'UNSUPPORTED_VIDEO_TYPE',
      error: 'Only MP4 walkthrough videos are supported.',
      status: 415,
    };
  }
  if (size > PROPERTY_VIDEO_MAX_BYTES) {
    return {
      code: 'VIDEO_TOO_LARGE',
      error: 'Video is too large. Maximum size is 16 MB.',
      status: 413,
    };
  }
  return null;
}
