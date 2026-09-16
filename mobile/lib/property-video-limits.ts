export const PROPERTY_VIDEO_PREMIUM_MAX_BYTES = 100 * 1024 * 1024;

export function exceedsPropertyVideoUploadCeiling(size: number): boolean {
  return size > PROPERTY_VIDEO_PREMIUM_MAX_BYTES;
}
