import { extractPdfImageAssets } from './image-extractor';
import { uploadPropertyImage } from '@/lib/storage/upload';
import type { PlanCandidate } from '@/lib/inventory/floor-plans';

const MAX_PHOTOS = 15;
const MAX_PLANS = 20;

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
