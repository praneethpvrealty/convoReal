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
  // Explicit <text> elements rather than a <pattern> fill.
  //
  // The pattern version rendered locally and drew NOTHING in production:
  // the composite completed, the JPEG re-encoded, and the served image
  // came back pixel-identical to a plain re-encode. sharp's SVG renderer
  // differs by build, and pattern-with-patternTransform is exactly the
  // kind of construct that varies. A watermark that silently no-ops is
  // worse than none, because the copy promises the recipient is
  // traceable — so this uses only rotated text, which every renderer
  // handles.
  const rows: string[] = [];
  // Spacing adapts to the image. A fixed 420px step put every baseline
  // outside a small thumbnail, marking nothing — the same silent
  // no-op this rewrite exists to prevent, just from geometry instead of
  // the renderer. Halving guarantees at least two marks per axis.
  const stepX = Math.max(140, Math.min(TILE, Math.round(width / 2)));
  const stepY = Math.max(
    90,
    Math.min(Math.round(TILE * 0.62), Math.round(height / 2))
  );
  // Start half a step in so the first baseline sits inside the canvas,
  // and overdraw the right/bottom edges so the rotation leaves no bare
  // corner.
  for (let y = Math.round(stepY / 2); y < height + stepY; y += stepY) {
    for (let x = -stepX; x < width + stepX; x += stepX) {
      rows.push(
        `<text x="${x}" y="${y}" transform="rotate(-30 ${x} ${y})" ` +
          `font-family="sans-serif" font-size="${FONT_SIZE}" ` +
          `fill="#ffffff" fill-opacity="0.42" ` +
          `stroke="#000000" stroke-opacity="0.22" stroke-width="0.6">${safe}</text>`
      );
    }
  }
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${rows.join('')}</svg>`,
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
