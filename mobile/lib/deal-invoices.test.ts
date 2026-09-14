import { describe, expect, it } from 'vitest';
import {
  INVOICE_SIZE_LIMIT,
  invoiceRejection,
  invoiceSizeLabel,
} from './deal-invoices';

describe('invoiceRejection', () => {
  it('accepts a PDF within the limit', () => {
    expect(invoiceRejection('application/pdf', 2048)).toBeNull();
  });

  it('refuses a video', () => {
    expect(invoiceRejection('video/mp4', 2048)).toContain('PDF');
  });

  it('refuses an empty file', () => {
    expect(invoiceRejection('image/jpeg', 0)).toBe('That file is empty.');
  });

  it('accepts a file whose size the picker did not report', () => {
    expect(invoiceRejection('application/pdf', null)).toBeNull();
  });

  it('refuses a file past the shared ceiling', () => {
    expect(invoiceRejection('image/jpeg', INVOICE_SIZE_LIMIT + 1)).toContain(
      '10 MB'
    );
  });
});

describe('invoiceSizeLabel', () => {
  it('renders KB under a megabyte and MB above it', () => {
    expect(invoiceSizeLabel(2048)).toBe('2 KB');
    expect(invoiceSizeLabel(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(invoiceSizeLabel(0)).toBe('');
  });
});
