import { inflateSync } from 'zlib';
import sharp from 'sharp';

// ============================================================
// Pulls the embedded raster images out of a PDF brochure.
//
// Two decode paths, because brochures mix them: photographs are
// /DCTDecode (a JPEG, usable as-is) while line art — site plans,
// floor plans, elevation drawings — is almost always /FlateDecode
// raw pixels, which have to be inflated, un-predicted and re-encoded.
// Reading only the JPEG path is why floor plans never reached a
// listing: the plans were in the file, in the format we skipped.
// ============================================================

const MIN_JPEG_BYTES = 20000; // 20 KB — skips logos and spacer graphics
const MIN_PIXELS = 200 * 200;
const MAX_PIXELS = 40_000_000; // guard against a corrupt /Width /Height

export interface PdfImageAsset {
  /** JPEG bytes, ready for uploadPropertyImage(). */
  buffer: Buffer;
  /** 1-based page the image appears on, by object order. Brochures are
   *  written page by page, so this is reliable enough to group plans
   *  with the floor they are captioned under — and it is only ever a
   *  hint: a wrong page costs a mis-ordered attachment, nothing more. */
  page: number;
  width: number;
  height: number;
  /** Line art rather than a photograph: near-white, low-saturation,
   *  which is what a floor plan looks like to a histogram. */
  isLineArt: boolean;
}

function dictValue(dict: string, key: string): string | null {
  const m = dict.match(new RegExp(`/${key}\\s*([^/\\]>\\s]+)`));
  return m ? m[1].trim() : null;
}

function dictNumber(dict: string, key: string): number | null {
  const raw = dictValue(dict, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function channelsFor(dict: string): number | null {
  const cs = dict.match(/\/ColorSpace\s*\/?(\w+)/);
  const name = cs ? cs[1] : '';
  if (/DeviceRGB|RGB/i.test(name)) return 3;
  if (/DeviceGray|Gray|CalGray/i.test(name)) return 1;
  if (/DeviceCMYK|CMYK/i.test(name)) return 4;
  // Indexed / ICCBased / separation palettes need full object
  // resolution to interpret. Skipped rather than guessed — a wrong
  // channel count renders as colourful noise, which is worse than
  // leaving the floor's plan for someone to attach by hand.
  return null;
}

/**
 * Undoes PNG row predictors (/Predictor >= 10), which Flate image
 * streams commonly carry. Each row is prefixed with a filter byte.
 */
function unpredict(
  data: Buffer,
  predictor: number,
  colors: number,
  bpc: number,
  columns: number
): Buffer | null {
  if (predictor < 10) return data;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  const stride = rowLen + 1;
  const rows = Math.floor(data.length / stride);
  if (rows <= 0) return null;

  const out = Buffer.alloc(rows * rowLen);
  let prev = Buffer.alloc(rowLen);

  for (let r = 0; r < rows; r++) {
    const filter = data[r * stride];
    const row = data.subarray(r * stride + 1, r * stride + 1 + rowLen);
    const cur = Buffer.alloc(rowLen);

    for (let i = 0; i < rowLen; i++) {
      const raw = row[i];
      const left = i >= bpp ? cur[i - bpp] : 0;
      const up = prev[i];
      const upLeft = i >= bpp ? prev[i - bpp] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          return null;
      }
      cur[i] = value & 0xff;
    }
    cur.copy(out, r * rowLen);
    prev = cur;
  }
  return out;
}

/** Byte offset of each page object, so an image can name its page. */
function pageOffsets(pdf: Buffer): number[] {
  const offsets: number[] = [];
  let pos = 0;
  while (true) {
    const idx = pdf.indexOf('/Type', pos);
    if (idx === -1) break;
    const window = pdf.subarray(idx, idx + 20).toString('latin1');
    if (/^\/Type\s*\/Page[^s]/.test(window)) offsets.push(idx);
    pos = idx + 5;
  }
  return offsets;
}

async function toJpeg(
  raw: Buffer,
  width: number,
  height: number,
  channels: number
): Promise<Buffer | null> {
  try {
    if (channels === 4) {
      // sharp's raw reader has no CMYK input, so flatten to RGB by hand.
      const rgb = Buffer.alloc(width * height * 3);
      for (let i = 0, o = 0; i + 3 < raw.length; i += 4, o += 3) {
        const k = raw[i + 3];
        rgb[o] = ((255 - raw[i]) * (255 - k)) / 255;
        rgb[o + 1] = ((255 - raw[i + 1]) * (255 - k)) / 255;
        rgb[o + 2] = ((255 - raw[i + 2]) * (255 - k)) / 255;
      }
      raw = rgb;
      channels = 3;
    }
    const expected = width * height * channels;
    if (raw.length < expected) return null;
    return await sharp(raw.subarray(0, expected), {
      raw: { width, height, channels: channels as 1 | 3 },
    })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
}

/** A floor plan is overwhelmingly white with dark linework, and carries
 *  almost no colour. A room photograph does neither. */
async function looksLikeLineArt(jpeg: Buffer): Promise<boolean> {
  try {
    const { channels, isOpaque } = await sharp(jpeg).stats();
    if (!channels.length) return false;
    const means = channels.slice(0, 3).map((c) => c.mean);
    const bright = means.every((m) => m > 175);
    const spread =
      means.length < 3 ? 0 : Math.max(...means) - Math.min(...means);
    return isOpaque && bright && spread < 12;
  } catch {
    return false;
  }
}

/**
 * Extracts embedded images from a PDF with the metadata needed to sort
 * plans from photographs. Failures on any single image are skipped
 * rather than thrown — a brochure with one unreadable object should
 * still give up the rest of its pictures.
 */
export async function extractPdfImageAssets(
  pdfBuffer: Buffer
): Promise<PdfImageAsset[]> {
  const assets: PdfImageAsset[] = [];
  const pages = pageOffsets(pdfBuffer);
  let pos = 0;

  while (true) {
    const streamStartIdx = pdfBuffer.indexOf('stream', pos);
    if (streamStartIdx === -1) break;

    // The object dictionary is whatever sits between the previous
    // 'obj' and this 'stream'.
    const objIdx = pdfBuffer.lastIndexOf('obj', streamStartIdx);
    if (objIdx === -1 || streamStartIdx - objIdx > 4000) {
      pos = streamStartIdx + 6;
      continue;
    }
    const dict = pdfBuffer.subarray(objIdx, streamStartIdx).toString('latin1');

    if (!/\/Subtype\s*\/Image/.test(dict)) {
      pos = streamStartIdx + 6;
      continue;
    }

    let binaryStart = streamStartIdx + 6;
    if (pdfBuffer[binaryStart] === 13) binaryStart++; // \r
    if (pdfBuffer[binaryStart] === 10) binaryStart++; // \n

    const streamEndIdx = pdfBuffer.indexOf('endstream', binaryStart);
    if (streamEndIdx === -1) break;

    const bytes = pdfBuffer.subarray(binaryStart, streamEndIdx);
    const width = dictNumber(dict, 'Width') ?? 0;
    const height = dictNumber(dict, 'Height') ?? 0;
    const page = pages.filter((o) => o <= objIdx).length || 1;

    const inRange =
      width > 0 &&
      height > 0 &&
      width * height >= MIN_PIXELS &&
      width * height <= MAX_PIXELS;

    if (inRange) {
      const isJpeg = /\/DCTDecode/.test(dict);
      const isFlate = /\/FlateDecode/.test(dict);

      let jpeg: Buffer | null = null;
      if (isJpeg && bytes[0] === 0xff && bytes[1] === 0xd8) {
        if (bytes.length >= MIN_JPEG_BYTES) jpeg = Buffer.from(bytes);
      } else if (isFlate) {
        const channels = channelsFor(dict);
        const bpc = dictNumber(dict, 'BitsPerComponent') ?? 8;
        if (channels && bpc === 8) {
          try {
            const inflated = inflateSync(bytes);
            const predictor = dictNumber(dict, 'Predictor') ?? 1;
            const raw = unpredict(
              Buffer.from(inflated),
              predictor,
              dictNumber(dict, 'Colors') ?? channels,
              bpc,
              dictNumber(dict, 'Columns') ?? width
            );
            if (raw) jpeg = await toJpeg(raw, width, height, channels);
          } catch {
            // Corrupt or externally-referenced stream — skip it.
          }
        }
      }

      if (jpeg) {
        assets.push({
          buffer: jpeg,
          page,
          width,
          height,
          isLineArt: await looksLikeLineArt(jpeg),
        });
      }
    }

    pos = streamEndIdx + 9;
  }

  return assets;
}

/**
 * Scans a PDF buffer for its embedded images, newest decode paths
 * included. Kept returning bare buffers for callers that only want
 * pictures — see extractPdfImageAssets() for page and line-art data.
 */
export async function extractImagesFromPdf(
  pdfBuffer: Buffer
): Promise<Buffer[]> {
  const assets = await extractPdfImageAssets(pdfBuffer);
  return assets.map((a) => a.buffer);
}
