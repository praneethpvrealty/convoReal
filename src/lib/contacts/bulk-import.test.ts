import { describe, expect, it } from 'vitest';

import {
  bulkImportFailureReason,
  bulkImportSummary,
  planBulkImport,
} from './bulk-import';

describe('[UIX-013] bulk contact import', () => {
  it('normalises with the account country code, not a hard-coded 91', () => {
    const plan = planBulkImport([{ name: 'Sam', phone: '4155550123' }], '1');
    expect(plan.ready).toEqual([{ index: 0, phone: '+14155550123' }]);
  });

  it('reports every skipped row with its reason', () => {
    const plan = planBulkImport(
      [
        { name: '', phone: '9845012345' },
        { name: 'No Number', phone: ' ' },
        { name: 'Short', phone: '123' },
        { name: 'Asha', phone: '98450 12345' },
        { name: 'Asha again', phone: '+91 98450-12345' },
      ],
      '91'
    );
    expect(plan.ready).toEqual([{ index: 3, phone: '+919845012345' }]);
    expect(plan.skipped.map((s) => [s.index, s.label, s.reason])).toEqual([
      [0, '9845012345', 'No name'],
      [1, 'No Number', 'No phone number'],
      [2, 'Short', 'Invalid phone number'],
      [4, 'Asha again', 'Same number as another row in this import'],
    ]);
  });

  it('explains a per-row database failure and summarises a partial import', () => {
    expect(bulkImportFailureReason({ code: '23505' })).toBe(
      'Already in your contacts'
    );
    expect(bulkImportFailureReason({ message: 'boom' })).toBe('boom');
    expect(bulkImportSummary({ imported: 1, problems: [] })).toBe(
      'Imported 1 contact'
    );
    expect(
      bulkImportSummary({
        imported: 3,
        problems: [{ index: 0, label: 'x', reason: 'y' }],
      })
    ).toBe('Imported 3 contacts; 1 not imported');
  });
});
