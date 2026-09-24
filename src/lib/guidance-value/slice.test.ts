import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { rateInstructions, slicePdf } from './rate-parse';

async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= count; i += 1) {
    doc.addPage([200 + i, 200]);
  }
  return doc.save();
}

describe('slicePdf', () => {
  it('[GVL-009] sends only the requested pages plus the one before them', async () => {
    const slice = await slicePdf(await pdfWithPages(36), 7, 8);
    expect(slice).toMatchObject({ pageCount: 36, firstPage: 6, lastPage: 8 });
    const excerpt = await PDFDocument.load(slice!.bytes);
    expect(excerpt.getPageCount()).toBe(3);
    expect(excerpt.getPage(0).getWidth()).toBe(206);
    expect(excerpt.getPage(2).getWidth()).toBe(208);
  });

  it('[GVL-009] starts at page 1 without a context page and stops at the last page', async () => {
    const first = await slicePdf(await pdfWithPages(5), 1, 2);
    expect(first).toMatchObject({ firstPage: 1, lastPage: 2 });
    const last = await slicePdf(await pdfWithPages(5), 5, 6);
    expect(last).toMatchObject({ firstPage: 4, lastPage: 5 });
  });

  it('falls back to the whole PDF when it cannot be split', async () => {
    expect(
      await slicePdf(new TextEncoder().encode('%PDF-junk'), 1, 2)
    ).toBeNull();
  });
});

describe('rateInstructions', () => {
  it('[GVL-009] maps excerpt pages back to notification pages and carries headings', async () => {
    const slice = await slicePdf(await pdfWithPages(36), 7, 8);
    const text = rateInstructions(7, 8, slice, {
      district: 'Bengaluru Urban',
      village: 'Malleshwaram',
    });
    expect(text).toContain('pages 6 to 8 of the notification');
    expect(text).toContain('Transcribe ONLY pages 7 to 8');
    expect(text).toContain('Page 6 is included only');
    expect(text).toContain('village "Malleshwaram"');
  });
});
