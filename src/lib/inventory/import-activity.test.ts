import { describe, expect, it } from 'vitest';
import { inventoryImportStatus } from './import-activity';

describe('inventory import status', () => {
  it.each(['Available', 'Under Contract', 'Sold', 'Off Market'])(
    'recognizes an accepted %s copy',
    (status) => {
      expect(inventoryImportStatus(status, 'active')).toBe('In inventory');
    }
  );
  it.each([
    ['Pending Review', 'Pending review'],
    ['Rejected', 'Rejected'],
    ['Archived', 'Archived'],
    ['unknown', 'Status unavailable'],
  ])('does not mislabel %s as an accepted import', (status, expected) => {
    expect(inventoryImportStatus(status, 'active')).toBe(expected);
  });
  it('distinguishes an archived agency from an active inventory', () => {
    expect(inventoryImportStatus('Available', 'archived')).toBe(
      'Agency archived'
    );
  });
});

describe('import counts', () => {
  it('keeps only listings someone has actually imported', async () => {
    const { toImportCountMap, importCountLabel } =
      await import('./import-activity');
    expect(
      toImportCountMap([
        { property_id: 'p1', import_count: 3 },
        { property_id: 'p2', import_count: 0 },
        { property_id: 'p3', import_count: null },
        { property_id: '', import_count: 2 },
      ])
    ).toEqual({ p1: 3 });
    expect(toImportCountMap(null)).toEqual({});
    expect(importCountLabel(1)).toBe('Shared by 1 agent');
    expect(importCountLabel(4)).toBe('Shared by 4 agents');
  });
});
