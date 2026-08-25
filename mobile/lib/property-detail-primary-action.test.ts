import { describe, expect, it } from 'vitest';

import { propertyDetailPrimaryAction } from './property-detail-primary-action';

describe('propertyDetailPrimaryAction', () => {
  it('keeps the selected-contact share action visible instead of Open Maps', () => {
    expect(
      propertyDetailPrimaryAction({
        selectedCount: 31,
        ownerPhone: false,
        hasMapLocation: true,
      })
    ).toEqual({
      kind: 'share',
      label: 'Share with 31 contacts',
      icon: 'paper-plane',
    });
  });

  it('restores the normal property action when no contacts are selected', () => {
    expect(
      propertyDetailPrimaryAction({
        selectedCount: 0,
        ownerPhone: false,
        hasMapLocation: true,
      })
    ).toEqual({ kind: 'maps', label: 'Open Maps', icon: 'map-outline' });
  });
});
