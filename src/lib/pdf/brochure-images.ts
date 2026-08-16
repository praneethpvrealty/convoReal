import { extractPdfImageAssets } from './image-extractor';
import {
  uploadPropertyImage,
  uploadPropertyDocument,
  DocumentTooLargeError,
} from '@/lib/storage/upload';
import type { PlanCandidate } from '@/lib/inventory/floor-plans';

const MAX_PHOTOS = 15;
const MAX_PLANS = 20;

export interface StoredBrochure {
  /** Stored path, or null when the file itself could not be kept. */
  url: string | null;
  /** Size of the file we had to drop, so the sender can be told why. */
  droppedBytes: number | null;
}

/**
 * Stores the brochure itself, tolerating one that is too big to keep.
 *
 * A brochure's worth to a listing is its contents — the parsed details,
 * the floor plans, the photos — all of which are extracted separately
 * and are a fraction of the size. When the file exceeds what storage
 * will take, keeping those and dropping the original beats refusing the
 * whole message, which is what used to happen. The caller says so in
 * its reply rather than letting the file vanish silently.
 */
export async function storeBrochureDocument(
  accountId: string,
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<StoredBrochure> {
  try {
    const url = await uploadPropertyDocument(
      accountId,
      buffer,
      mimeType,
      filename
    );
    return { url, droppedBytes: null };
  } catch (err) {
    if (err instanceof DocumentTooLargeError) {
      console.warn(
        `[brochure-images] "${filename}" is ${buffer.length} bytes, past the storage ceiling — keeping its contents, dropping the file.`
      );
      return { url: null, droppedBytes: buffer.length };
    }
    throw err;
  }
}

export interface BrochureImages {
  /** Photographs, for the listing's image gallery. */
  photos: string[];
  /** Line drawings, for matching onto floors. */
  planCandidates: PlanCandidate[];
}

/**
 * Pulls a brochure's pictures out and stores them, split by what they
 * are: photographs go to the gallery, line drawings are held back as
 * floor-plan candidates so `attachPlanImages()` can pin each one to
 * the floor it belongs to.
 *
 * Individual upload failures are dropped, not thrown — a brochure that
 * gives up nine of its ten pictures is still worth keeping.
 */
export async function uploadBrochureImages(
  accountId: string,
  pdfBuffer: Buffer
): Promise<BrochureImages> {
  const assets = await extractPdfImageAssets(pdfBuffer).catch(() => []);
  if (assets.length === 0) return { photos: [], planCandidates: [] };

  const plans = assets.filter((a) => a.isLineArt).slice(0, MAX_PLANS);
  const photos = assets.filter((a) => !a.isLineArt).slice(0, MAX_PHOTOS);

  const stored = await Promise.all(
    [...plans, ...photos].map((asset) =>
      uploadPropertyImage(accountId, asset.buffer, 'image/jpeg')
        .then((url) => ({ url, page: asset.page }))
        .catch((err) => {
          console.error('[brochure-images] upload failed:', err);
          return null;
        })
    )
  );

  return {
    planCandidates: stored
      .slice(0, plans.length)
      .filter((s): s is PlanCandidate => s !== null),
    photos: stored
      .slice(plans.length)
      .filter((s): s is PlanCandidate => s !== null)
      .map((s) => s.url),
  };
}
