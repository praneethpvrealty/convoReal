/**
 * A let listing is stored as Sold when its deal closes, like any other:
 * the deal sync, the market stats and the closed-listing filters all
 * read that one value. What a person reads is worded for the listing
 * type instead. Mobile bundles this file through `@shared/`, so it
 * imports nothing.
 */

export type ClosedStatusWord = 'Sold' | 'Rented' | 'Leased';

export function closedStatusWord(
  listingType: string | null | undefined
): ClosedStatusWord {
  if (listingType === 'Rent') return 'Rented';
  if (listingType === 'Built to Suit') return 'Leased';
  return 'Sold';
}

export function listingStatusLabel(
  status: string | null | undefined,
  listingType: string | null | undefined
): string {
  const value = (status ?? '').trim();
  return value === 'Sold' ? closedStatusWord(listingType) : value;
}

/** "sold", "rented out" or "leased out", for a sentence. */
export function closedStatusPhrase(
  listingType: string | null | undefined
): string {
  const word = closedStatusWord(listingType);
  return word === 'Sold' ? 'sold' : `${word.toLowerCase()} out`;
}

export function closedPriceLabel(
  listingType: string | null | undefined
): string {
  return closedStatusWord(listingType) === 'Sold'
    ? 'Final sale price'
    : 'Final rent / month';
}
