// ------------------------------------------------------------------
// What the sticky bar and the hero say about what a listing costs.
//
// Pure, so it runs under the plain Node test runner. Mirrors the web's
// price box (src/components/showcase/showcase-view.tsx) and share
// message (src/lib/share-message-builder.ts): a JV/JD deal has no
// asking price to print, and a Built to Suit listing is priced per
// month like a rental.
// ------------------------------------------------------------------

import { formatInr } from './format';
import type { Property } from './types';

export interface ListingPrice {
  /** Caption above the amount in the sticky bar. */
  label: string;
  value: string;
  /** The line under the amount, when the listing carries one. */
  note: string | null;
}

/** Web parity: "Equivalent to: ₹15 Crore" under the formatted price. */
function equivalentInr(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null;
  const trim = (v: number) =>
    v
      .toFixed(2)
      .replace(/\.00$/, '')
      .replace(/\.(\d)0$/, '.$1');
  if (n >= 10000000) return `Equivalent to: ₹${trim(n / 10000000)} Crore`;
  if (n >= 100000) return `Equivalent to: ₹${trim(n / 100000)} Lakhs`;
  return `Equivalent to: ₹${n.toLocaleString('en-IN')}`;
}

export function listingPrice(property: Property): ListingPrice {
  if (
    property.listing_type === 'Rent' ||
    property.listing_type === 'Built to Suit'
  ) {
    const rent = property.rent_per_month;
    return {
      label: 'RENT',
      value: rent ? `${formatInr(rent)}/month` : '—',
      note: equivalentInr(rent),
    };
  }

  if (property.listing_type === 'JV/JD') {
    const owner = property.owner_share_percent;
    const builder = property.builder_share_percent;
    return {
      label: 'DEAL',
      value: owner && builder ? `${owner}:${builder} share` : 'JV / JD',
      note: property.price > 0 ? `Est. ${formatInr(property.price)}` : null,
    };
  }

  return {
    label: 'PRICE',
    value: formatInr(property.price),
    note: equivalentInr(property.price),
  };
}
