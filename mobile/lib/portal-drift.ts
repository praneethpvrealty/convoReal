export function driftHeadline(count: number): string {
  return count === 1
    ? "1 portal ad doesn't match your listings"
    : `${count} portal ads don't match your listings`;
}

export function driftToggleLabel(expanded: boolean): string {
  return expanded ? 'Hide' : 'Review';
}

export function propertyHref(propertyId: string): string {
  return `/(app)/property/${encodeURIComponent(propertyId)}`;
}

export type PortalRowStatus = 'active' | 'expired' | 'removed';

export function canUpdatePortalListings(
  profile:
    { account_role: string; is_read_only?: boolean | null } | null | undefined
): boolean {
  if (!profile) return false;
  return profile.account_role !== 'viewer' && !profile.is_read_only;
}

export function canMarkRemoved(row: { status: PortalRowStatus }): boolean {
  return row.status !== 'removed';
}

export function canEditExpiry(row: { status: PortalRowStatus }): boolean {
  return row.status !== 'removed';
}

export function portalRowStatusLabel(status: PortalRowStatus): string | null {
  if (status === 'removed') return 'Removed';
  if (status === 'expired') return 'Expired';
  return null;
}
