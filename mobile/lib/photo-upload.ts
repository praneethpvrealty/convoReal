export interface UploadBatchResult<T> {
  uploaded: string[];
  failed: T[];
  lastError: string | null;
}

export async function uploadEach<T>(
  items: T[],
  upload: (item: T) => Promise<string>,
  onProgress: (done: number, total: number) => void,
  onUploaded: (path: string) => void
): Promise<UploadBatchResult<T>> {
  const uploaded: string[] = [];
  const failed: T[] = [];
  let lastError: string | null = null;
  for (let i = 0; i < items.length; i++) {
    onProgress(i + 1, items.length);
    try {
      const path = await upload(items[i]);
      uploaded.push(path);
      onUploaded(path);
    } catch (e) {
      failed.push(items[i]);
      lastError = e instanceof Error ? e.message : null;
    }
  }
  return { uploaded, failed, lastError };
}

export function uploadProgressLabel(done: number, total: number): string {
  return total > 1 ? `Uploading ${done} of ${total}` : 'Uploading…';
}

export function restorePhoto(
  images: string[],
  photo: string,
  index: number
): string[] {
  if (images.includes(photo)) return images;
  const at = Math.min(Math.max(index, 0), images.length);
  return [...images.slice(0, at), photo, ...images.slice(at)];
}
