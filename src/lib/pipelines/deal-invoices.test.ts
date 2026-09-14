import { describe, expect, it } from 'vitest';
import {
  INVOICE_SIZE_LIMIT,
  invoiceDisplayName,
  invoiceObjectPath,
  isOwnedInvoicePath,
  parseDealInvoices,
  rejectInvoiceFile,
  safeInvoiceFilename,
} from './deal-invoices';

const ACCOUNT = '11111111-1111-1111-1111-111111111111';
const DEAL = '22222222-2222-2222-2222-222222222222';

describe('rejectInvoiceFile', () => {
  it('accepts a PDF within the limit', () => {
    expect(rejectInvoiceFile('application/pdf', 1024)).toBeNull();
  });

  it('refuses an unsupported type', () => {
    expect(rejectInvoiceFile('video/mp4', 1024)?.code).toBe('UNSUPPORTED_TYPE');
  });

  it('refuses an empty file', () => {
    expect(rejectInvoiceFile('application/pdf', 0)?.code).toBe('EMPTY_FILE');
  });

  it('refuses a file past the bucket ceiling', () => {
    expect(rejectInvoiceFile('image/png', INVOICE_SIZE_LIMIT + 1)?.code).toBe(
      'FILE_TOO_LARGE'
    );
  });
});

describe('safeInvoiceFilename', () => {
  it('strips path separators and traversal', () => {
    expect(safeInvoiceFilename('../../etc/passwd')).toBe('passwd');
    expect(safeInvoiceFilename('a/b/invoice.pdf')).toBe('invoice.pdf');
  });

  it('keeps a readable name', () => {
    expect(safeInvoiceFilename('Brokerage Invoice #7.pdf')).toBe(
      'Brokerage_Invoice__7.pdf'
    );
  });

  it('falls back when nothing usable is left', () => {
    expect(safeInvoiceFilename('...')).toBe('invoice');
  });
});

describe('invoiceObjectPath', () => {
  it('nests the object under the account and the deal', () => {
    const path = invoiceObjectPath(ACCOUNT, DEAL, 'receipt.pdf');
    expect(path.startsWith(`${ACCOUNT}/${DEAL}/`)).toBe(true);
    expect(path.endsWith('-receipt.pdf')).toBe(true);
    expect(isOwnedInvoicePath(path, ACCOUNT, DEAL)).toBe(true);
  });
});

describe('isOwnedInvoicePath', () => {
  it('refuses another account or another deal', () => {
    const path = invoiceObjectPath(ACCOUNT, DEAL, 'receipt.pdf');
    expect(isOwnedInvoicePath(path, 'other-account', DEAL)).toBe(false);
    expect(isOwnedInvoicePath(path, ACCOUNT, 'other-deal')).toBe(false);
  });

  it('refuses traversal out of the deal folder', () => {
    expect(
      isOwnedInvoicePath(`${ACCOUNT}/${DEAL}/../../other/x.pdf`, ACCOUNT, DEAL)
    ).toBe(false);
  });
});

describe('parseDealInvoices', () => {
  it('returns an empty list for anything that is not an array', () => {
    expect(parseDealInvoices(null)).toEqual([]);
    expect(parseDealInvoices({})).toEqual([]);
  });

  it('drops entries with no path and fills missing fields', () => {
    expect(
      parseDealInvoices([
        { path: `${ACCOUNT}/${DEAL}/1700000000000-ab12cd-invoice.pdf` },
        { name: 'no path' },
        null,
      ])
    ).toEqual([
      {
        path: `${ACCOUNT}/${DEAL}/1700000000000-ab12cd-invoice.pdf`,
        name: 'invoice.pdf',
        size: 0,
        uploaded_at: '',
        uploaded_by: null,
      },
    ]);
  });
});

describe('invoiceDisplayName', () => {
  it('strips the upload prefix', () => {
    expect(
      invoiceDisplayName(`${ACCOUNT}/${DEAL}/1700000000000-ab12cd-inv.pdf`)
    ).toBe('inv.pdf');
  });

  it('leaves a plain filename alone', () => {
    expect(invoiceDisplayName(`${ACCOUNT}/${DEAL}/inv.pdf`)).toBe('inv.pdf');
  });
});
