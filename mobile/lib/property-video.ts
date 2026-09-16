export function propertyVideoLimitCopy(maxBytes: number | null): string {
  if (!maxBytes || !Number.isFinite(maxBytes)) {
    return 'Upload one MP4 — limit checked for your plan';
  }
  return `Upload one MP4 up to ${Math.round(maxBytes / (1024 * 1024))} MB`;
}
