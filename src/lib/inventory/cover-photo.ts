export interface PixelSample {
  paperShare: number;
  greyShare: number;
}

const PAPER_MIN_CHANNEL = 200;
const GREY_MAX_SPREAD = 28;

export function samplePixels(data: ArrayLike<number>, stride = 4): PixelSample {
  const pixels = Math.floor(data.length / stride);
  if (pixels === 0) return { paperShare: 0, greyShare: 0 };
  let paper = 0;
  let grey = 0;
  for (let i = 0; i < pixels; i++) {
    const r = data[i * stride];
    const g = data[i * stride + 1];
    const b = data[i * stride + 2];
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread <= GREY_MAX_SPREAD) {
      grey++;
      if (Math.min(r, g, b) >= PAPER_MIN_CHANNEL) paper++;
    }
  }
  return { paperShare: paper / pixels, greyShare: grey / pixels };
}

export function looksLikeDocument(sample: PixelSample): boolean {
  return sample.paperShare >= 0.55 && sample.greyShare >= 0.85;
}

export function orderForCover<T>(
  items: T[],
  isDocument: (item: T) => boolean
): T[] {
  const photos: T[] = [];
  const documents: T[] = [];
  for (const item of items) (isDocument(item) ? documents : photos).push(item);
  return [...photos, ...documents];
}
