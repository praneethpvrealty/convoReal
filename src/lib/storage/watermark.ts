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
// ============================================================

import sharp from 'sharp';

/** Repeat spacing of the tile, in pixels of the resized output. */
const TILE = 420;
const FONT_SIZE = 20;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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

function overlaySvg(text: string, width: number, height: number): Buffer {
  const safe = escapeXml(text);
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs>` +
      `<pattern id="wm" width="${TILE}" height="${TILE}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">` +
      `<text x="0" y="${TILE / 2}" font-family="sans-serif" font-size="${FONT_SIZE}" ` +
      `fill="#ffffff" fill-opacity="0.34" stroke="#000000" stroke-opacity="0.18" stroke-width="0.6">${safe}</text>` +
      `</pattern>` +
      `</defs>` +
      `<rect width="${width}" height="${height}" fill="url(#wm)" />` +
      `</svg>`,
    'utf-8'
  );
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

    const buffer = await image
      .composite([{ input: overlaySvg(label, width, height), top: 0, left: 0 }])
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    return { buffer, contentType: 'image/jpeg' };
  } catch (err) {
    console.error('[watermark] Failed, serving original:', err);
    return { buffer: input, contentType: 'image/jpeg' };
  }
}
