import { describe, expect, it } from 'vitest';

import {
  canEditExpiry,
  canMarkRemoved,
  canUpdatePortalListings,
  driftHeadline,
  driftToggleLabel,
  portalRowStatusLabel,
  propertyHref,
} from './portal-drift';

describe('portal drift banner', () => {
  it('[PRP-028] headline is singular for one ad', () => {
    expect(driftHeadline(1)).toBe("1 portal ad doesn't match your listings");
  });

  it('[PRP-028] headline is plural for several ads', () => {
    expect(driftHeadline(2)).toBe("2 portal ads don't match your listings");
    expect(driftHeadline(11)).toBe("11 portal ads don't match your listings");
  });

  it('[PRP-028] toggle reads Review when collapsed and Hide when expanded', () => {
    expect(driftToggleLabel(false)).toBe('Review');
    expect(driftToggleLabel(true)).toBe('Hide');
  });

  it('[PRP-028] property href targets the property detail screen', () => {
    expect(propertyHref('abc-123')).toBe('/(app)/property/abc-123');
    expect(propertyHref('a/b')).toBe('/(app)/property/a%2Fb');
  });

  it('[PRP-028] an active or expired ad can be marked removed', () => {
    expect(canMarkRemoved({ status: 'active' })).toBe(true);
    expect(canMarkRemoved({ status: 'expired' })).toBe(true);
  });

  it('[PRP-028] a removed ad offers neither mark removed nor an expiry edit', () => {
    expect(canMarkRemoved({ status: 'removed' })).toBe(false);
    expect(canEditExpiry({ status: 'removed' })).toBe(false);
    expect(canEditExpiry({ status: 'active' })).toBe(true);
  });

  it('[PRP-028] agents and above can update portal listings', () => {
    expect(canUpdatePortalListings({ account_role: 'agent' })).toBe(true);
    expect(canUpdatePortalListings({ account_role: 'admin' })).toBe(true);
    expect(
      canUpdatePortalListings({ account_role: 'owner', is_read_only: false })
    ).toBe(true);
  });

  it('[PRP-028] viewers and read-only members only read portal listings', () => {
    expect(canUpdatePortalListings({ account_role: 'viewer' })).toBe(false);
    expect(
      canUpdatePortalListings({ account_role: 'agent', is_read_only: true })
    ).toBe(false);
    expect(canUpdatePortalListings(null)).toBe(false);
    expect(canUpdatePortalListings(undefined)).toBe(false);
  });

  it('[PRP-028] row status label names expired and removed ads only', () => {
    expect(portalRowStatusLabel('removed')).toBe('Removed');
    expect(portalRowStatusLabel('expired')).toBe('Expired');
    expect(portalRowStatusLabel('active')).toBeNull();
  });
});
