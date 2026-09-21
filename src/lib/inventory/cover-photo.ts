// ============================================================
// Which upload becomes a listing's cover.
//
// Agents attach scanned letters, khata extracts and bank notices to a
// listing alongside its photos, and the first upload was the cover no
// matter what it showed — so an inventory grid could lead with a page
// of typed text instead of the property. A scan is mostly paper: bright
// pixels with almost no colour. Photographs of buildings, plots and
// rooms are not. That difference is enough to keep a scan out of the
// cover slot without deciding anything else about it.
// ============================================================

export interface PixelSample {
  /** Share of sampled pixels that are near-white. */
  paperShare: number;
  /** Share of sampled pixels with little colour in them. */
  greyShare: number;
}

const PAPER_MIN_CHANNEL = 200;
const GREY_MAX_SPREAD = 28;

/** Reads RGBA pixel data (as a canvas gives it) into the two shares
 *  the classifier needs. Alpha is ignored. */
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

/** True for a scan or screenshot of a document: most of the frame is
 *  paper and nearly all of it is colourless. A white-walled interior
 *  shot keeps enough colour and shadow to stay below both lines. */
export function looksLikeDocument(sample: PixelSample): boolean {
  return sample.paperShare >= 0.55 && sample.greyShare >= 0.85;
}

/** Photos first, in the order given; documents after, in the order
 *  given. The cover is whatever comes first. */
export function orderForCover<T>(
  items: T[],
  isDocument: (item: T) => boolean
): T[] {
  const photos: T[] = [];
  const documents: T[] = [];
  for (const item of items) (isDocument(item) ? documents : photos).push(item);
  return [...photos, ...documents];
}
