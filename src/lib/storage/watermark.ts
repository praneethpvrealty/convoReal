// ============================================================
// Viewer watermarking for guarded photos.
//
// Gating decides who may open a confidential listing; it cannot stop
// the one person who legitimately opened it from screenshotting the
// photos and forwarding them. Attribution is what actually deters that:
// a photo that carries the recipient's own masked number is traceable
// back to the key it was served under, and the recipient knows it.
//
// Applied at the read boundary — the two service-role proxies that
// stream from the private bucket — never at upload. The stored original
// stays clean, and the label follows whoever fetched it.
//
// The label is drawn from the bitmap font in ./watermark-font, not from
// SVG text: the runtime has no fonts for sharp's SVG renderer, so every
// <text> element it composited drew nothing while reporting success.
// ============================================================

import sharp, { type OverlayOptions } from 'sharp';
import { renderTextTile } from './watermark-font';

/** Repeat spacing of the tile, in pixels of the output. */
const TILE = 420;

/**
 * The line burned into the image. Masked, not raw: the point is that
 * the holder recognises their own number, not that a leaked photo
 * publishes someone's contact details to whoever receives it.
 */
export function watermarkLabel(args: {
  viewerLabel?: string | null;
  reference: string;
}): string {
  const who = (args.viewerLabel || '').trim();
  return who
    ? `${who} · ${args.reference}`
    : `Confidential · ${args.reference}`;
}

/** Scale the glyphs to the photo so the mark is legible on a 4000px
 *  original and still fits inside a 400px thumbnail. */
function glyphScale(width: number): number {
  return Math.max(2, Math.min(5, Math.round(width / 320)));
}

/**
 * Burns `label` across the image as a tiled diagonal overlay and
 * re-encodes to JPEG.
 *
 * Never throws: a photo that cannot be watermarked is served
 * unwatermarked rather than not at all. The gate is the security
 * boundary — this is deterrence layered on top, and failing it closed
 * would break a legitimate reveal over a cosmetic step.
 */
export async function watermarkImage(
  input: Buffer,
  label: string
): Promise<{ buffer: Buffer; contentType: string }> {
  try {
    const image = sharp(input).rotate();
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 1 || height < 1) {
      return { buffer: input, contentType: 'image/jpeg' };
    }

    const tile = renderTextTile(label, glyphScale(width));
    let stamp = await sharp(tile.data, {
      raw: { width: tile.width, height: tile.height, channels: 4 },
    })
      .rotate(-30, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    let stampMeta = await sharp(stamp).metadata();
    // A stamp wider than the photo composites nowhere, which is the
    // silent no-op again. Shrink it to fit instead of skipping.
    if ((stampMeta.width ?? 0) > width || (stampMeta.height ?? 0) > height) {
      stamp = await sharp(stamp)
        .resize({ width, height, fit: 'inside' })
        .png()
        .toBuffer();
      stampMeta = await sharp(stamp).metadata();
    }
    const stampW = stampMeta.width ?? tile.width;
    const stampH = stampMeta.height ?? tile.height;

    // Spacing adapts to the photo. A fixed step put every stamp outside
    // a small thumbnail, marking nothing — the same silent no-op this
    // module exists to prevent, just from geometry. Halving guarantees
    // at least two marks per axis.
    const stepX = Math.max(stampW + 24, Math.min(TILE, Math.round(width / 2)));
    const stepY = Math.max(
      stampH + 24,
      Math.min(Math.round(TILE * 0.62), Math.round(height / 2))
    );

    const layers: OverlayOptions[] = [];
    let row = 0;
    for (let top = 0; top + stampH <= height; top += stepY, row++) {
      const offset = row % 2 === 0 ? 0 : Math.round(stepX / 2);
      for (let left = offset; left + stampW <= width; left += stepX) {
        layers.push({ input: stamp, top, left });
      }
    }
    if (layers.length === 0) {
      layers.push({ input: stamp, top: 0, left: 0 });
    }

    const buffer = await image
      .composite(layers)
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    return { buffer, contentType: 'image/jpeg' };
  } catch (err) {
    console.error('[watermark] Failed, serving original:', err);
    return { buffer: input, contentType: 'image/jpeg' };
  }
}
