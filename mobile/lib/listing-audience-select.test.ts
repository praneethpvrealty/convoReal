import { describe, it, expect } from 'vitest';
import {
  audienceListingLabel,
  reachableAudienceIds,
} from './listing-audience-select';
import type { AudienceContact } from '@shared/lib/inventory/listing-audience';

function member(overrides: Partial<AudienceContact> = {}): AudienceContact {
  return {
    contactId: 'c1',
    name: 'Asha',
    phone: '919000000001',
    classification: 'Buyer',
    nameTag: null,
    enquired: true,
    viewed: false,
    viewsCount: 0,
    lastAt: null,
    ...overrides,
  };
}

describe('audienceListingLabel', () => {
  it('prefers the code, falls back to the title', () => {
    const base = { propertyId: 'p1', contactsCount: 1, lastAt: null };
    expect(
      audienceListingLabel({ ...base, title: 'Villa', propertyCode: 'CR-1' })
    ).toBe('CR-1');
    expect(
      audienceListingLabel({ ...base, title: 'Villa', propertyCode: null })
    ).toBe('Villa');
    expect(
      audienceListingLabel({ ...base, title: null, propertyCode: null })
    ).toBe('Untitled listing');
  });
});

describe('reachableAudienceIds', () => {
  it('keeps only members the match list can select', () => {
    const { ids, unreachable } = reachableAudienceIds(
      [member({ contactId: 'c1' }), member({ contactId: 'c2' })],
      [{ id: 'c1', phone: '919000000001' }]
    );
    expect(ids).toEqual(['c1']);
    expect(unreachable).toBe(1);
  });

  it('drops a member with no number on either side', () => {
    const { ids, unreachable } = reachableAudienceIds(
      [member({ contactId: 'c1', phone: null })],
      [{ id: 'c1', phone: null }]
    );
    expect(ids).toEqual([]);
    expect(unreachable).toBe(1);
  });
});
