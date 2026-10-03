export interface TextSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  mono?: boolean;
}

type Style = Omit<TextSegment, 'text'>;

const MARKERS: Record<string, keyof Style> = {
  '*': 'bold',
  _: 'italic',
  '~': 'strike',
};

const MONO = '```';

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function push(out: TextSegment[], text: string, style: Style) {
  if (!text) return;
  const last = out[out.length - 1];
  if (
    last &&
    !!last.bold === !!style.bold &&
    !!last.italic === !!style.italic &&
    !!last.strike === !!style.strike &&
    !!last.mono === !!style.mono
  ) {
    last.text += text;
    return;
  }
  out.push({ text, ...style });
}

function findClose(line: string, marker: string, from: number): number {
  for (let j = from; j < line.length; j++) {
    if (line[j] !== marker) continue;
    if (/\s/.test(line[j - 1] ?? '')) continue;
    if (isWordChar(line[j + 1])) continue;
    return j;
  }
  return -1;
}

function parseLine(line: string, style: Style, out: TextSegment[]) {
  let i = 0;
  let plainStart = 0;
  while (i < line.length) {
    const key = MARKERS[line[i]];
    if (
      key &&
      !style[key] &&
      !isWordChar(line[i - 1]) &&
      !/\s/.test(line[i + 1] ?? '') &&
      line[i + 1] !== undefined
    ) {
      const close = findClose(line, line[i], i + 2);
      if (close !== -1) {
        push(out, line.slice(plainStart, i), style);
        parseLine(line.slice(i + 1, close), { ...style, [key]: true }, out);
        i = close + 1;
        plainStart = i;
        continue;
      }
    }
    i++;
  }
  push(out, line.slice(plainStart), style);
}

function parseLines(text: string, out: TextSegment[]) {
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    parseLine(line, {}, out);
    if (index < lines.length - 1) push(out, '\n', {});
  });
}

export function parseWhatsAppFormatting(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf(MONO, cursor);
    const close = open === -1 ? -1 : text.indexOf(MONO, open + MONO.length);
    if (open === -1 || close <= open + MONO.length) break;
    parseLines(text.slice(cursor, open), out);
    push(out, text.slice(open + MONO.length, close), { mono: true });
    cursor = close + MONO.length;
  }
  parseLines(text.slice(cursor), out);
  return out;
}

export function plainText(text: string): string {
  return parseWhatsAppFormatting(text)
    .map((s) => s.text)
    .join('');
}

const HEADER_LINE = /^[^\p{L}\p{N}*]*\*[^*\n]+\*[^\p{L}\p{N}*]*$/u;

export function conversationPreview(text: string | null | undefined): string {
  if (!text) return '';
  const lines = text.split('\n');
  const firstIndex = lines.findIndex((l) => l.trim().length > 0);
  if (firstIndex !== -1) {
    const first = lines[firstIndex].trim();
    const rest = lines.slice(firstIndex + 1);
    if (HEADER_LINE.test(first) && rest.some((l) => l.trim().length > 0)) {
      return plainText(rest.join('\n')).replace(/\s+/g, ' ').trim();
    }
  }
  return plainText(text).replace(/\s+/g, ' ').trim();
}
