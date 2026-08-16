import { describe, expect, it } from 'vitest';

import {
  documentLabel,
  parsePropertyDocuments,
  DOCUMENT_SIZE_LIMIT,
} from './property-documents';

describe('documentLabel', () => {
  it('strips the bucket, account folder and upload stamp', () => {
    expect(
      documentLabel('property-documents/acc-1/1754899200000-Sale_Deed.pdf')
    ).toBe('Sale Deed.pdf');
  });

  it('keeps a name that carries no stamp', () => {
    expect(documentLabel('property-documents/acc-1/khata.pdf')).toBe(
      'khata.pdf'
    );
  });

  it('does not mistake a short leading number for a stamp', () => {
    // "2024-tax-receipt.pdf" is a name, not a stamped upload — the
    // stamp is a millisecond epoch, so at least 10 digits.
    expect(documentLabel('property-documents/acc-1/2024-tax_receipt.pdf')).toBe(
      '2024-tax receipt.pdf'
    );
  });

  it('falls back to the last segment for an unexpected shape', () => {
    expect(documentLabel('khata.pdf')).toBe('khata.pdf');
    expect(documentLabel('a/b/')).toBe('b');
  });
});

describe('parsePropertyDocuments', () => {
  // The web form writes the titled shape; reading it as a path put the
  // whole JSON blob into the storage URL, so the link 404'd and the row
  // read as `<file>.pdf","title":"Land sketch"}`.
  it('takes the url and the given name out of a titled entry', () => {
    expect(
      parsePropertyDocuments([
        '{"url":"property-documents/acc-1/1754899200000-BYCHART.pdf","title":"Land sketch"}',
      ])
    ).toEqual([
      {
        raw: '{"url":"property-documents/acc-1/1754899200000-BYCHART.pdf","title":"Land sketch"}',
        url: 'property-documents/acc-1/1754899200000-BYCHART.pdf',
        label: 'Land sketch',
      },
    ]);
  });

  it('falls back to the filename when the entry carries no title', () => {
    expect(
      parsePropertyDocuments([
        '{"url":"property-documents/acc-1/1754899200000-Sale_Deed.pdf","title":""}',
      ])[0].label
    ).toBe('Sale Deed.pdf');
  });

  it('still reads a bare path, which is what the phone uploads', () => {
    const path = 'property-documents/acc-1/1754899200000-khata.pdf';
    expect(parsePropertyDocuments([path])).toEqual([
      { raw: path, url: path, label: 'khata.pdf' },
    ]);
  });

  it('drops blanks, entries with no url, and a missing array', () => {
    expect(parsePropertyDocuments(['', '   ', '{"title":"No url"}'])).toEqual(
      []
    );
    expect(parsePropertyDocuments(null)).toEqual([]);
  });

  it('keeps the stored entry verbatim so a removal can match it', () => {
    const raw = ' property-documents/acc-1/khata.pdf ';
    expect(parsePropertyDocuments([raw])[0].raw).toBe(raw);
  });
});

describe('DOCUMENT_SIZE_LIMIT', () => {
  it('matches the WhatsApp document ceiling and the bucket', () => {
    expect(DOCUMENT_SIZE_LIMIT).toBe(100 * 1024 * 1024);
  });
});
