/**
 * Helvetica glyph widths, in 1/1000 em, for ASCII 32–126.
 *
 * These are Adobe's published metrics for the base-14 fonts, which
 * every PDF reader already has — so an invoice embeds no font file and
 * still renders identically everywhere. They are here because a PDF
 * gives no way to ask "how wide is this string": right-aligning an
 * amount column or centring a title means measuring it ourselves, and
 * an approximation would leave the rupee figures visibly ragged.
 */

const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];

const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
  556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584,
];

export type PdfFont = 'regular' | 'bold';

/** Width of one character in 1/1000 em. Unknown glyphs fall back to the
 *  width of a space, which is what they will have been replaced with. */
function charWidth(code: number, font: PdfFont): number {
  const widths = font === 'bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  const index = code - 32;
  if (index < 0 || index >= widths.length) return widths[0];
  return widths[index];
}

/** Width of a string in points at a given size. */
export function textWidth(text: string, font: PdfFont, size: number): number {
  let total = 0;
  for (let i = 0; i < text.length; i += 1) {
    total += charWidth(text.charCodeAt(i), font);
  }
  return (total * size) / 1000;
}

/**
 * Break text to fit a column, on word boundaries where it can and
 * mid-word only when a single word is itself too long — an unbroken
 * 40-character RERA registration must not silently run into the next
 * column.
 */
export function wrapText(
  text: string,
  font: PdfFont,
  size: number,
  maxWidth: number
): string[] {
  const words = String(text ?? '')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];

  const lines: string[] = [];
  let current = '';

  const pushBroken = (word: string) => {
    let chunk = '';
    for (const char of word) {
      if (textWidth(chunk + char, font, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, font, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    if (textWidth(word, font, size) > maxWidth) {
      pushBroken(word);
    } else {
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}
