import { describe, expect, it } from 'vitest';

import { documentLabel, DOCUMENT_SIZE_LIMIT } from './property-documents';

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

describe('DOCUMENT_SIZE_LIMIT', () => {
  it('stays below the WhatsApp attachment ceiling', () => {
    expect(DOCUMENT_SIZE_LIMIT).toBe(25 * 1024 * 1024);
    expect(DOCUMENT_SIZE_LIMIT).toBeLessThan(100 * 1024 * 1024);
  });
});
