// ============================================================
// A 5x7 stroke font, drawn into raw pixels.
//
// Two SVG-based watermarks in a row rendered locally and drew nothing in
// production: first a <pattern> fill, then explicit rotated <text>. The
// composite succeeded and the JPEG re-encoded both times, so the failure
// was silent — the served photo came back identical to a plain
// re-encode. sharp's SVG renderer needs a font engine with fonts
// installed, and the Vercel runtime has neither.
//
// So no renderer is involved here at all: glyphs are bitmaps, the label
// is written into an RGBA buffer by hand, and sharp only rotates and
// composites. What renders locally is then the same bytes that render in
// production.
// ============================================================

const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '·': ['00000', '00000', '00000', '00100', '00000', '00000', '00000'],
  // The masked-phone bullet. Without it every masked digit fell back to
  // the unknown-character glyph and the label read as noise.
  '•': ['00000', '00000', '01110', '01110', '01110', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'],
  ':': ['00000', '00100', '00000', '00000', '00000', '00100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '*': ['00000', '10101', '01110', '11111', '01110', '10101', '00000'],
};

export const GLYPH_W = 5;
export const GLYPH_H = 7;

export interface RgbaTile {
  data: Buffer;
  width: number;
  height: number;
}

/** Width in pixels the label occupies at the given scale. */
export function textWidth(text: string, scale: number): number {
  const n = Math.max(text.length, 1);
  return n * (GLYPH_W + 1) * scale;
}

/**
 * Writes `text` into a fresh transparent RGBA tile: white glyphs over a
 * dark one-pixel halo, so the label stays readable on both a bright sky
 * and a dark interior.
 */
export function renderTextTile(text: string, scale: number): RgbaTile {
  const chars = text.toUpperCase().split('');
  const pad = scale * 2;
  const width = textWidth(text, scale) + pad * 2;
  const height = GLYPH_H * scale + pad * 2;
  const data = Buffer.alloc(width * height * 4, 0);

  const put = (x: number, y: number, v: number, alpha: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    if (data[o + 3] >= alpha) return;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
    data[o + 3] = alpha;
  };

  chars.forEach((ch, index) => {
    const glyph = GLYPHS[ch] ?? GLYPHS['*'];
    const originX = pad + index * (GLYPH_W + 1) * scale;
    for (let gy = 0; gy < GLYPH_H; gy++) {
      const row = glyph[gy];
      for (let gx = 0; gx < GLYPH_W; gx++) {
        if (row[gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const x = originX + gx * scale + sx;
            const y = pad + gy * scale + sy;
            put(x + scale, y + scale, 0, 110);
            put(x, y, 255, 165);
          }
        }
      }
    }
  });

  return { data, width, height };
}
