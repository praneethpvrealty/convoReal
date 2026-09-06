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
