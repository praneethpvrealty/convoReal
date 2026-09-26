import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  rateColumns,
  rateInstructions,
  rateParseTier,
  sanitiseRateRows,
  slicePdf,
} from './rate-parse';

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

  it('[GVL-012] slices a notification loaded once as it does from bytes', async () => {
    const bytes = await pdfWithPages(12);
    const doc = await PDFDocument.load(bytes);
    const fromDoc = await slicePdf(doc, 5, 6);
    const fromBytes = await slicePdf(bytes, 5, 6);
    expect(fromDoc).toMatchObject({ pageCount: 12, firstPage: 4, lastPage: 6 });
    expect((await PDFDocument.load(fromDoc!.bytes)).getPageCount()).toBe(
      (await PDFDocument.load(fromBytes!.bytes)).getPageCount()
    );
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

  it('[GVL-022] carries the previous page rate columns to a page without a header', () => {
    const columns = rateColumns([
      { property_class: 'agricultural', land_class: 'dry', unit: 'acre' },
      { property_class: 'agricultural', land_class: 'wet', unit: 'acre' },
      { property_class: 'agricultural', land_class: 'garden', unit: 'acre' },
      { property_class: 'residential_site', unit: 'sqm' },
      { property_class: 'agricultural', land_class: 'dry', unit: 'acre' },
    ]);
    expect(columns).toEqual([
      { code: 'ad', unit: 'acre' },
      { code: 'aw', unit: 'acre' },
      { code: 'ab', unit: 'acre' },
      { code: 'rs', unit: 'sqm' },
    ]);
    const text = rateInstructions(236, 237, null, null, null, columns);
    expect(text).toContain('the first rate column is "ad" (acre)');
    expect(text).toContain('the fourth rate column is "rs" (sqm)');
    expect(rateInstructions(236, 237)).not.toContain('rate column is');
  });

  it('[GVL-021] asks Gemini to mark lakh columns and keep land columns off site codes', () => {
    const text = rateInstructions(7, 8);
    expect(text).toContain('"lakh/acre"');
    expect(text).toContain('never a site, apartment');
    expect(text).toContain(
      'Never do this for a column printed per gunta, hectare, square metre or'
    );
  });

  it('[GVL-020] tells Gemini the unit the notification header states', () => {
    expect(rateInstructions(7, 8, null, null, 'sqm')).toContain(
      'rate header states rates per square metre ("sqm")'
    );
    expect(rateInstructions(7, 8, null, null, null)).not.toContain(
      'rate header states'
    );
  });
});

describe('sanitiseRateRows', () => {
  it('[GVL-009] drops rows Gemini returns from the context page', () => {
    const row = {
      locality: 'Malleshwaram',
      property_class: 'residential_site',
      rate: 100,
      unit: 'sqm',
    };
    const { rows } = sanitiseRateRows(
      {
        rows: [
          { ...row, page: 6 },
          { ...row, page: 7 },
          { ...row, page: 8 },
        ],
      },
      7,
      8,
      6
    );
    expect(rows.map((r) => r.page)).toEqual([7, 8]);
  });
});

describe('rateParseTier', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('[GVL-010] reads rates on the lite model unless told otherwise', () => {
    vi.stubEnv('GEMINI_IMPORT_TIER', '');
    expect(rateParseTier()).toBe('lite');
    vi.stubEnv('GEMINI_IMPORT_TIER', 'standard');
    expect(rateParseTier()).toBe('standard');
  });
});
