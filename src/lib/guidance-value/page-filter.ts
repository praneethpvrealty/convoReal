import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from 'pdf-lib';

const RATE_SIGNAL =
  /\b(villages?|hobli|main roads?|cross roads?|interior|layouts?|survey|s\.?\s*no\.?|potential area|extensions?|nagar|colony|cross|roads?|streets?|block no|ward no|plots?|sites?|khata)\b|\b\d{1,3}-\d{1,3}-\d{1,4}[A-Za-z]?\b/i;

const NON_RATE_PAGE =
  /\b(ready reckoner|special amenities|amenities|car parking|cellar|stilt|weightage|(calculation|worked) examples?|general guidelines?|special instructions|construction (rates?|costs?)|building (rates?|types?|costs?)|floor[- ]?(wise|rise|weightage)|gazette|valuation committee)\b/i;

const KNOWN_MIN_CHARS = 20;
const LEADING_SKIP_MAX = 30;
const LEADING_MIN_NUMBERS = 5;

type GlyphMap = Map<string, string>;

function utf16(hex: string): string {
  const codes: number[] = [];
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    codes.push(parseInt(hex.slice(i, i + 4), 16));
  }
  return String.fromCharCode(...codes);
}

function parseToUnicode(text: string): GlyphMap {
  const map: GlyphMap = new Map();
  const key = (code: number) => code.toString(16).padStart(4, '0');
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(key(parseInt(m[1], 16)), utf16(m[2]));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g
    )) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (hi < lo || hi - lo > 65535) continue;
      if (m[3].startsWith('[')) {
        [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((x, i) =>
          map.set(key(lo + i), utf16(x[1]))
        );
        continue;
      }
      const base = m[3].slice(1, -1);
      const prefix = base.slice(0, -4);
      const start = parseInt(base.slice(-4), 16);
      for (let code = lo; code <= hi; code += 1) {
        map.set(key(code), utf16(prefix + key(start + code - lo)));
      }
    }
  }
  return map;
}

function streamText(doc: PDFDocument, obj: unknown): string | null {
  const stream = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  if (!(stream instanceof PDFRawStream)) return null;
  try {
    return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  } catch {
    return null;
  }
}

interface FontInfo {
  glyphs: GlyphMap | null;
  twoByte: boolean;
}

function pageFonts(
  doc: PDFDocument,
  page: ReturnType<PDFDocument['getPage']>
): Map<string, FontInfo> {
  const fonts = new Map<string, FontInfo>();
  const dict = page.node.Resources()?.lookup(PDFName.of('Font'));
  if (!(dict instanceof PDFDict)) return fonts;
  for (const [name, ref] of dict.entries()) {
    const font = doc.context.lookup(ref);
    if (!(font instanceof PDFDict)) continue;
    const cmap = streamText(doc, font.get(PDFName.of('ToUnicode')));
    fonts.set(name.decodeText(), {
      glyphs: cmap ? parseToUnicode(cmap) : null,
      twoByte: font.get(PDFName.of('Subtype')) === PDFName.of('Type0'),
    });
  }
  return fonts;
}

function decodeHex(hex: string, font: FontInfo | undefined): string {
  if (font?.glyphs) {
    let out = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) {
      out += font.glyphs.get(hex.slice(i, i + 4)) ?? '';
    }
    return out;
  }
  if (font?.twoByte) return '';
  return Buffer.from(hex, 'hex').toString('latin1');
}

const CONTENT_TOKEN =
  /\/([^\s/[\]<>()]+)\s+[\d.-]+\s+Tf|<([0-9A-Fa-f]*)>|\(((?:\\.|[^\\)])*)\)|(TJ|Tj|T\*|Td|TD|Tm|ET)\b/g;

export function pageText(doc: PDFDocument, index: number): string {
  const page = doc.getPage(index);
  const fonts = pageFonts(doc, page);
  const contents = page.node.Contents();
  const resolved =
    contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  const streams =
    resolved instanceof PDFArray ? resolved.asArray() : [resolved];
  const parts: string[] = [];
  let font: FontInfo | undefined;
  for (const item of streams) {
    const text = streamText(doc, item);
    if (!text) continue;
    for (const m of text.matchAll(CONTENT_TOKEN)) {
      if (m[1]) font = fonts.get(m[1]);
      else if (m[2] !== undefined)
        parts.push(decodeHex(m[2].toLowerCase(), font));
      else if (m[3] !== undefined) {
        parts.push(m[3].replace(/\\([()\\])/g, '$1').replace(/\\\d{3}/g, ''));
      } else parts.push(' ');
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export function pageTexts(doc: PDFDocument): string[] {
  return Array.from({ length: doc.getPageCount() }, (_, index) => {
    try {
      return pageText(doc, index);
    } catch {
      return '';
    }
  });
}

function printableChars(text: string): number {
  return (text.match(/[A-Za-z0-9\u0C80-\u0CFF]/g) ?? []).length;
}

function readable(text: string): boolean {
  if (printableChars(text) < KNOWN_MIN_CHARS) return false;
  const words = text.match(/[A-Za-z]+/g) ?? [];
  if (words.length < 8) return true;
  return words.filter((word) => word.length <= 2).length / words.length < 0.6;
}

function largeNumbers(text: string): number {
  return (text.match(/\b\d{1,2},\d{2},\d{3}\b|\b\d{4,}\b/g) ?? []).length;
}

function numericGrid(text: string): boolean {
  return (
    /^[\d\s.,()%]*$/.test(text.replace(/[^\x20-\x7e]/g, '')) &&
    (text.match(/[\u0C80-\u0CFF]/g) ?? []).length < 40
  );
}

export function planSkippedPages(texts: string[]): boolean[] {
  const known = texts.map(readable);
  const rateWords = texts.map((text) => RATE_SIGNAL.test(text));
  const nonRate = texts.map(
    (text, i) => known[i] && !rateWords[i] && NON_RATE_PAGE.test(text)
  );
  const first = texts.findIndex(
    (text, i) =>
      known[i] && rateWords[i] && largeNumbers(text) >= LEADING_MIN_NUMBERS
  );
  const skip = texts.map(() => false);
  if (first < 0) return skip;
  for (let i = 0; i < first && i < LEADING_SKIP_MAX; i += 1) {
    skip[i] =
      known[i] &&
      !rateWords[i] &&
      (nonRate[i] || largeNumbers(texts[i]) < LEADING_MIN_NUMBERS);
  }
  for (let i = first; i < texts.length; i += 1) {
    if (!known[i] || rateWords[i]) continue;
    if (nonRate[i] || (skip[i - 1] && numericGrid(texts[i]))) skip[i] = true;
  }
  return skip;
}

export function skippedRunEnd(skip: boolean[], fromPage: number): number {
  let page = fromPage;
  while (page <= skip.length && skip[page - 1]) page += 1;
  return page - 1;
}
