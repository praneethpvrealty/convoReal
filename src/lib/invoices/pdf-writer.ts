/**
 * A very small PDF writer.
 *
 * Enough to place text, rules and one JPEG on a single page, and no
 * more. It exists instead of a PDF library because a brokerage invoice
 * is a fixed one-page form in the built-in Helvetica: nothing here needs
 * font subsetting, layout engines or compression, and the alternatives
 * are a 1.5 MB dependency or a headless Chromium that will not fit in a
 * serverless function.
 *
 * The two things it does carefully are the ones that are unforgiving:
 * byte offsets in the cross-reference table, and the `/ByteRange` a
 * digital signature is measured over.
 */

import { escapePdfText, toWinAnsi } from './pdf-text';
import { textWidth, type PdfFont } from './pdf-fonts';

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

/** Hex zeros reserved for a PKCS#7 signature. 16 KB of hex holds a
 *  Class 3 or eSign CMS blob with room for its certificate chain. */
const SIGNATURE_PLACEHOLDER_BYTES = 8192;

export interface JpegImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface SignaturePlaceholder {
  /** Printed under the signature field in a reader's signature panel. */
  reason: string;
  location?: string;
  contactInfo?: string;
  /** Where the field sits on the page, in PDF points from bottom-left. */
  rect: [number, number, number, number];
}

export interface PdfDocumentOptions {
  title: string;
  author?: string;
  subject?: string;
  /** Fixed so the same invoice renders byte-identically every time,
   *  which is what makes `document_hash` meaningful. */
  creationDate: Date;
  image?: JpegImage | null;
  signature?: SignaturePlaceholder | null;
}

type Align = 'left' | 'right' | 'center';

export interface TextOptions {
  font?: PdfFont;
  size?: number;
  align?: Align;
  /** 0 is black, 1 is white. */
  gray?: number;
}

/**
 * Collects drawing operations for one page.
 *
 * Coordinates are PDF points from the bottom-left, which is what the
 * format uses — the layout code converts from its own top-down cursor
 * once, at the edge, rather than every call flipping the axis.
 */
export class PdfPage {
  private ops: string[] = [];

  text(value: string, x: number, y: number, options: TextOptions = {}): this {
    const content = toWinAnsi(value);
    if (!content.trim()) return this;

    const font = options.font ?? 'regular';
    const size = options.size ?? 9;
    const align = options.align ?? 'left';

    let drawX = x;
    if (align !== 'left') {
      const width = textWidth(content, font, size);
      drawX = align === 'right' ? x - width : x - width / 2;
    }

    const gray = options.gray ?? 0;
    this.ops.push(
      `q ${gray} g BT /${font === 'bold' ? 'F2' : 'F1'} ${size} Tf ` +
        `${round(drawX)} ${round(y)} Td (${escapePdfText(content)}) Tj ET Q`
    );
    return this;
  }

  /** A horizontal or diagonal rule. */
  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width = 0.5,
    gray = 0
  ): this {
    this.ops.push(
      `q ${gray} G ${width} w ${round(x1)} ${round(y1)} m ${round(x2)} ${round(y2)} l S Q`
    );
    return this;
  }

  /** An unfilled box — the item table's grid. */
  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth = 0.5,
    gray = 0
  ): this {
    this.ops.push(
      `q ${gray} G ${lineWidth} w ${round(x)} ${round(y)} ${round(width)} ${round(height)} re S Q`
    );
    return this;
  }

  /** A filled box — table header shading. */
  fillRect(
    x: number,
    y: number,
    width: number,
    height: number,
    gray = 0.92
  ): this {
    this.ops.push(
      `q ${gray} g ${round(x)} ${round(y)} ${round(width)} ${round(height)} re f Q`
    );
    return this;
  }

  /** Places the document's single image (the scanned signature). */
  image(x: number, y: number, width: number, height: number): this {
    this.ops.push(
      `q ${round(width)} 0 0 ${round(height)} ${round(x)} ${round(y)} cm /Im1 Do Q`
    );
    return this;
  }

  toContentStream(): string {
    return this.ops.join('\n');
  }
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function pdfDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Assemble the page into a PDF file.
 *
 * Objects are emitted in order and their byte offsets recorded as they
 * go, because the cross-reference table at the end has to point at the
 * exact first byte of each one — a reader seeks by those numbers and
 * shows nothing at all if they are off by one.
 */
export function buildPdf(
  page: PdfPage,
  options: PdfDocumentOptions
): Uint8Array {
  const content = page.toContentStream();
  const contentBytes = Buffer.from(content, 'latin1');

  const objects: Buffer[] = [];
  const add = (body: string | Buffer): number => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'));
    return objects.length; // 1-based object number
  };

  const hasImage = Boolean(options.image);
  const hasSignature = Boolean(options.signature);

  // Object numbers are fixed up front so dictionaries can reference each
  // other before the referenced object has been written.
  const catalogNo = 1;
  const pagesNo = 2;
  const pageNo = 3;
  const contentNo = 4;
  const fontRegularNo = 5;
  const fontBoldNo = 6;
  const infoNo = 7;
  let next = 8;
  const imageNo = hasImage ? next++ : 0;
  const sigFieldNo = hasSignature ? next++ : 0;
  const sigValueNo = hasSignature ? next++ : 0;

  const resources: string[] = [
    `/Font << /F1 ${fontRegularNo} 0 R /F2 ${fontBoldNo} 0 R >>`,
  ];
  if (hasImage) resources.push(`/XObject << /Im1 ${imageNo} 0 R >>`);

  const annots = hasSignature ? ` /Annots [${sigFieldNo} 0 R]` : '';

  add(
    `<< /Type /Catalog /Pages ${pagesNo} 0 R${
      hasSignature
        ? ` /AcroForm << /Fields [${sigFieldNo} 0 R] /SigFlags 3 >>`
        : ''
    } >>`
  );
  add(`<< /Type /Pages /Kids [${pageNo} 0 R] /Count 1 >>`);
  add(
    `<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] ` +
      `/Resources << ${resources.join(' ')} >> /Contents ${contentNo} 0 R${annots} >>`
  );
  add(
    Buffer.concat([
      Buffer.from(`<< /Length ${contentBytes.length} >>\nstream\n`, 'latin1'),
      contentBytes,
      Buffer.from('\nendstream', 'latin1'),
    ])
  );
  add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  );
  add(
    `<< /Title (${escapePdfText(options.title)}) ` +
      `/Author (${escapePdfText(options.author ?? '')}) ` +
      `/Subject (${escapePdfText(options.subject ?? '')}) ` +
      `/Producer (ConvoReal) /Creator (ConvoReal) ` +
      `/CreationDate (${pdfDate(options.creationDate)}) ` +
      `/ModDate (${pdfDate(options.creationDate)}) >>`
  );

  if (hasImage && options.image) {
    // JPEG data passes straight through as /DCTDecode — the bytes are
    // already a complete JPEG, so there is nothing to re-encode.
    add(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${options.image.width} ` +
            `/Height ${options.image.height} /ColorSpace /DeviceRGB ` +
            `/BitsPerComponent 8 /Filter /DCTDecode ` +
            `/Length ${options.image.data.length} >>\nstream\n`,
          'latin1'
        ),
        Buffer.from(options.image.data),
        Buffer.from('\nendstream', 'latin1'),
      ])
    );
  }

  if (hasSignature && options.signature) {
    const { rect, reason, location, contactInfo } = options.signature;
    add(
      `<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) ` +
        `/Rect [${rect.map(round).join(' ')}] /F 4 /P ${pageNo} 0 R ` +
        `/V ${sigValueNo} 0 R >>`
    );
    // The placeholder the signer fills. /ByteRange and /Contents are
    // padded to a fixed width so the real values can be written over
    // them without moving a single byte of the rest of the file — the
    // signature covers everything except its own /Contents, so the file
    // must not change size after it is computed.
    add(
      `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached ` +
        `/Reason (${escapePdfText(reason)}) ` +
        `/Location (${escapePdfText(location ?? '')}) ` +
        `/ContactInfo (${escapePdfText(contactInfo ?? '')}) ` +
        `/M (${pdfDate(options.creationDate)}) ` +
        `/ByteRange [0 ${'*'.repeat(10)} ${'*'.repeat(10)} ${'*'.repeat(10)}] ` +
        `/Contents <${'0'.repeat(SIGNATURE_PLACEHOLDER_BYTES * 2)}> >>`
    );
  }

  const chunks: Buffer[] = [
    Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1'),
  ];
  let offset = chunks[0].length;
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    const header = Buffer.from(`${index + 1} 0 obj\n`, 'latin1');
    const footer = Buffer.from('\nendobj\n', 'latin1');
    offsets.push(offset);
    const full = Buffer.concat([header, body, footer]);
    chunks.push(full);
    offset += full.length;
  });

  const xrefOffset = offset;
  const count = objects.length + 1;
  const xrefLines = ['xref', `0 ${count}`, '0000000000 65535 f '];
  for (const entry of offsets) {
    xrefLines.push(`${String(entry).padStart(10, '0')} 00000 n `);
  }
  chunks.push(Buffer.from(`${xrefLines.join('\n')}\n`, 'latin1'));

  const id = hashId(options.title, options.creationDate);
  chunks.push(
    Buffer.from(
      `trailer\n<< /Size ${count} /Root ${catalogNo} 0 R /Info ${infoNo} 0 R ` +
        `/ID [<${id}> <${id}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      'latin1'
    )
  );

  const pdf = Buffer.concat(chunks);
  return hasSignature ? patchByteRange(pdf) : new Uint8Array(pdf);
}

/**
 * Write the real `/ByteRange` over the placeholder.
 *
 * A PDF signature covers the whole file *except* the hex string holding
 * the signature itself, so the range is [start of file, up to the `<`]
 * and [after the `>`, to the end]. It can only be computed once the file
 * is assembled, which is why the placeholder is padded to a fixed width:
 * the substitution must not change the length of anything.
 */
function patchByteRange(pdf: Buffer): Uint8Array {
  const contentsMarker = Buffer.from('/Contents <', 'latin1');
  const contentsAt = pdf.indexOf(contentsMarker);
  if (contentsAt === -1) return new Uint8Array(pdf);

  const hexStart = contentsAt + contentsMarker.length - 1; // at the '<'
  const hexEnd = pdf.indexOf(Buffer.from('>', 'latin1'), hexStart) + 1;
  if (hexEnd <= hexStart) return new Uint8Array(pdf);

  const rangeMarker = Buffer.from('/ByteRange [', 'latin1');
  const rangeAt = pdf.indexOf(rangeMarker);
  if (rangeAt === -1) return new Uint8Array(pdf);
  const rangeEnd = pdf.indexOf(Buffer.from(']', 'latin1'), rangeAt);
  if (rangeEnd === -1) return new Uint8Array(pdf);

  const values = [0, hexStart, hexEnd, pdf.length - hexEnd];
  const replacement = `/ByteRange [${values.join(' ')}`;
  const slotWidth = rangeEnd - rangeAt;
  if (replacement.length > slotWidth) return new Uint8Array(pdf);

  const padded = replacement.padEnd(slotWidth, ' ');
  pdf.write(padded, rangeAt, 'latin1');
  return new Uint8Array(pdf);
}

/** A stable /ID: same document in, same identifier out. */
function hashId(title: string, date: Date): string {
  let h1 = 0x811c9dc5;
  const seed = `${title}|${date.toISOString()}`;
  for (let i = 0; i < seed.length; i += 1) {
    h1 ^= seed.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0').repeat(4);
}
