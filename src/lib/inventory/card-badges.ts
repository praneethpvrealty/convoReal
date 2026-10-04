export function listingCardStatus(
  status: string | null | undefined
): string | null {
  if (!status || status === 'Available') return null;
  return status;
}
