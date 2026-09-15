import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  financialYearFor,
  formatInvoiceDate,
  formatInvoiceNumber,
  toDateOnly,
} from './financial-year';

describe('financialYearFor', () => {
  // [INV-001] The reference invoice is dated 08/09/2026 and numbered 101/2026-27.
  it('puts a September 2026 invoice in 2026-27', () => {
    expect(financialYearFor('2026-09-08')).toBe('2026-27');
  });

  it('starts a new year on 1 April, not 1 January', () => {
    expect(financialYearFor('2026-03-31')).toBe('2025-26');
    expect(financialYearFor('2026-04-01')).toBe('2026-27');
  });

  it('keeps January to March in the year that began the previous April', () => {
    expect(financialYearFor('2027-01-15')).toBe('2026-27');
    expect(financialYearFor('2027-03-31')).toBe('2026-27');
    expect(financialYearFor('2027-04-01')).toBe('2027-28');
  });

  it('pads the short end year across a century boundary', () => {
    expect(financialYearFor('2099-04-01')).toBe('2099-00');
  });

  // A date-only string parsed as UTC would be the previous day for any
  // user behind UTC, moving a 1 April invoice into the wrong year.
  it('reads a date-only string as the day that was typed', () => {
    expect(financialYearFor('2026-04-01')).toBe('2026-27');
    expect(formatInvoiceDate('2026-04-01')).toBe('01/04/2026');
  });

  it('accepts a Date and the day-first form', () => {
    expect(financialYearFor(new Date(2026, 8, 8))).toBe('2026-27');
    expect(financialYearFor('08/09/2026')).toBe('2026-27');
  });

  it('refuses an unparseable date rather than inventing a year', () => {
    expect(() => financialYearFor('not a date')).toThrow(/invalid date/i);
  });
});

describe('formatInvoiceNumber', () => {
  // [INV-001]
  it('reproduces the reference invoice number', () => {
    expect(formatInvoiceNumber(101, '2026-27')).toBe('101/2026-27');
  });

  it('prepends an account prefix when one is set', () => {
    expect(formatInvoiceNumber(101, '2026-27', 'PVC')).toBe('PVC/101/2026-27');
  });

  it('ignores an empty or slash-padded prefix', () => {
    expect(formatInvoiceNumber(7, '2026-27', '   ')).toBe('7/2026-27');
    expect(formatInvoiceNumber(7, '2026-27', 'PVC/')).toBe('PVC/7/2026-27');
  });
});

describe('date formatting', () => {
  it('prints day-first for the invoice and ISO for storage', () => {
    expect(formatInvoiceDate('2026-09-08')).toBe('08/09/2026');
    expect(toDateOnly('2026-09-08')).toBe('2026-09-08');
    expect(toDateOnly(new Date(2026, 8, 8))).toBe('2026-09-08');
  });

  it('returns empty rather than "Invalid Date" for junk', () => {
    expect(formatInvoiceDate('nonsense')).toBe('');
    expect(toDateOnly('nonsense')).toBe('');
  });
});

describe('the database agrees with financialYearFor', () => {
  // [INV-001] `issue_invoice()` derives the financial year in SQL,
  // because allocation and assignment have to sit in one transaction.
  // Two implementations of the same rule can drift, so these are the
  // exact pairs checked against the live database when the migration
  // was applied — if the TypeScript side ever moves, this fails and the
  // SQL has to move with it.
  const agreed: Array<[string, string]> = [
    ['2026-03-31', '2025-26'],
    ['2026-04-01', '2026-27'],
    ['2026-09-08', '2026-27'],
    ['2026-12-31', '2026-27'],
    ['2027-01-15', '2026-27'],
    ['2027-03-31', '2026-27'],
    ['2027-04-01', '2027-28'],
    ['2099-04-01', '2099-00'],
  ];

  it.each(agreed)('%s is %s on both sides', (date, expected) => {
    expect(financialYearFor(date)).toBe(expected);
  });

  it('keeps the April boundary in the SQL too', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260914174500_issue_invoice_atomic.sql'
      ),
      'utf8'
    );
    expect(migration).toContain(
      'EXTRACT(MONTH FROM v_invoice.invoice_date) >= 4'
    );
    expect(migration).toContain('LPAD(');
  });
});
