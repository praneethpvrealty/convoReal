import { describe, expect, it } from 'vitest';
import { INVENTORY_SYNC_HEADER as WEB_HEADER } from '@shared/lib/inventory/card-columns';
import {
  cardListRequest,
  INVENTORY_SYNC_HEADER,
  syncImportedListings,
} from './property-card-request';

describe('cardListRequest', () => {
  it('[PRP-071] asks the list for card columns and keeps every other param', () => {
    const { path } = cardListRequest(
      new URLSearchParams({ page: '0', limit: '20', search: 'villa' })
    );
    const params = new URLSearchParams(path.split('?')[1]);

    expect(path.startsWith('/api/properties?')).toBe(true);
    expect(params.get('fields')).toBe('card');
    expect(params.get('search')).toBe('villa');
    expect(params.get('limit')).toBe('20');
  });

  it('[PRP-072] tells the route this client runs the source sync itself', () => {
    expect(INVENTORY_SYNC_HEADER).toBe(WEB_HEADER);
    expect(cardListRequest(new URLSearchParams()).init).toEqual({
      headers: { 'x-inventory-sync': 'client' },
    });
  });
});

describe('syncImportedListings', () => {
  it('[PRP-072] reloads the list only when the sync imported something', () => {
    expect(syncImportedListings({ data: { imported: 2, matched: 3 } })).toBe(
      true
    );
    expect(syncImportedListings({ data: { imported: 0, matched: 3 } })).toBe(
      false
    );
    expect(syncImportedListings(null)).toBe(false);
    expect(syncImportedListings({ error: 'Forbidden' })).toBe(false);
  });
});
