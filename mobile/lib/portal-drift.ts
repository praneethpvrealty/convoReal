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
