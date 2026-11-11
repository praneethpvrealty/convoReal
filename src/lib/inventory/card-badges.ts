import { listingStatusLabel } from './listing-status-label';

export function listingCardStatus(
  status: string | null | undefined,
  listingType?: string | null
): string | null {
  if (!status || status === 'Available') return null;
  return listingStatusLabel(status, listingType);
}
