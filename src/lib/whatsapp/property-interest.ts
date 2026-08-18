import { toSquareFeet } from '@/lib/area-units';
import { consonantSkeleton } from '@/lib/project-match';
import { localityStems } from '@/lib/locality-match';
import type { Property } from '@/types';

export type PropertyInterestCandidate = Pick<
  Property,
  | 'id'
  | 'title'
  | 'property_code'
  | 'status'
  | 'is_published'
  | 'land_area'
  | 'land_area_unit'
  | 'area_sqft'
  | 'area_unit'
  | 'sublocality'
  | 'locality_canonical'
  | 'location'
  | 'project'
  | 'tags'
>;

export type PropertyReferenceResolution<T extends PropertyInterestCandidate> =
  | { kind: 'match'; matchedBy: 'code' | 'title' | 'natural'; property: T }
  | { kind: 'ambiguous'; candidates: T[] }
  | { kind: 'unresolved' };

export interface WhatsAppCatalogOrder {
  text?: string | null;
  product_items?: Array<{
    product_retailer_id: string;
    quantity?: string | number;
    item_price?: string | number;
    currency?: string;
  }>;
}

const GENERIC_STEMS = new Set([
  'acre',
  'commercial',
  'details',
  'interested',
  'land',
  'listing',
  'property',
  'residential',
  'saw',
  'seen',
  'that',
  'this',
  'want',
]);

const AREA_PATTERN =
  /\b(\d+(?:\.\d+)?)\s*(sq\.?\s*(?:ft|feet|yard|yards|meter|meters|mtr|mtrs)|sqft|sqyd|sqm|acres?|guntas?|gunthas?|grounds?|cents?)\b/i;

export function mentionedAreaSqft(text: string): number | null {
  const match = AREA_PATTERN.exec(text || '');
  if (!match) return null;
  return toSquareFeet(Number(match[1]), match[2]);
}

export function isDirectPropertyInterest(text?: string | null): boolean {
  const value = (text || '').trim();
  if (!value) return false;

  const sawListing =
    /\b(?:i|we)\s+(?:saw|have seen|had seen|noticed|liked)\b/i.test(value);
  const refersBack =
    /\b(?:interested|interest|details?|information)\b[^.!?\n]{0,60}\b(?:that|this|the)\s+(?:one|property|listing)?\b/i.test(
      value
    );
  const asksAboutReference =
    /\b(?:that|this)\s+(?:one|property|listing)\b[^.!?\n]{0,60}\b(?:interested|details?|information)\b/i.test(
      value
    );

  return sawListing || refersBack || asksAboutReference;
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function propertyAreaSqft(property: PropertyInterestCandidate): number | null {
  return (
    toSquareFeet(property.land_area, property.land_area_unit) ??
    toSquareFeet(property.area_sqft, property.area_unit)
  );
}

function comparableStems(value: string): string[] {
  return localityStems(value).filter(
    (stem) => stem.length >= 3 && !GENERIC_STEMS.has(stem)
  );
}

function stemsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  const aSkeleton = consonantSkeleton(a);
  const bSkeleton = consonantSkeleton(b);
  return aSkeleton.length >= 3 && aSkeleton === bSkeleton;
}

function locatorStems(property: PropertyInterestCandidate): string[] {
  const primary = [
    property.sublocality,
    property.locality_canonical,
    property.project,
  ].filter((value): value is string => Boolean(value?.trim()));
  const fields = primary.length ? primary : [property.location, property.title];
  return [...new Set(fields.flatMap((value) => comparableStems(value || '')))];
}

function exactTitleMatch<T extends PropertyInterestCandidate>(
  text: string,
  candidates: T[]
): T | null {
  const haystack = normalized(text);
  return (
    candidates
      .filter((property) => {
        const title = normalized(property.title);
        return title.length >= 8 && haystack.includes(title);
      })
      .sort((a, b) => b.title.length - a.title.length)[0] ?? null
  );
}

export function resolvePropertyReference<T extends PropertyInterestCandidate>(
  text: string,
  candidates: T[]
): PropertyReferenceResolution<T> {
  const value = (text || '').trim();
  if (!value || candidates.length === 0) return { kind: 'unresolved' };

  const lower = value.toLowerCase();
  const byCode = candidates
    .flatMap((property) =>
      [property.property_code, property.id]
        .filter((identifier): identifier is string => Boolean(identifier))
        .map((identifier) => ({
          property,
          position: lower.indexOf(identifier.toLowerCase()),
        }))
    )
    .filter(({ position }) => position >= 0)
    .sort((a, b) => a.position - b.position)[0]?.property;
  if (byCode) return { kind: 'match', matchedBy: 'code', property: byCode };

  const byTitle = exactTitleMatch(value, candidates);
  if (byTitle) return { kind: 'match', matchedBy: 'title', property: byTitle };

  if (!isDirectPropertyInterest(value)) return { kind: 'unresolved' };

  const wantedArea = mentionedAreaSqft(value);
  const messageStems = comparableStems(value);
  const ranked = candidates
    .filter(
      (property) =>
        property.is_published === true && property.status === 'Available'
    )
    .map((property) => {
      const matchedLocators = locatorStems(property).filter((candidate) =>
        messageStems.some((message) => stemsMatch(candidate, message))
      );
      if (matchedLocators.length === 0) return null;

      let sizeScore = 0;
      if (wantedArea !== null) {
        const actualArea = propertyAreaSqft(property);
        if (
          actualArea === null ||
          Math.abs(actualArea - wantedArea) / wantedArea > 0.1
        ) {
          return null;
        }
        sizeScore = 30;
      }

      return {
        property,
        score: 50 + sizeScore + Math.min(matchedLocators.length, 2) * 5,
      };
    })
    .filter((entry): entry is { property: T; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return { kind: 'unresolved' };
  const top = ranked.filter((entry) => entry.score === ranked[0].score);
  if (top.length > 1) {
    return {
      kind: 'ambiguous',
      candidates: top.map((entry) => entry.property),
    };
  }
  return {
    kind: 'match',
    matchedBy: 'natural',
    property: ranked[0].property,
  };
}

function firstName(name?: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'there';
}

export function buildPropertyInterestAck(
  contactName: string | null | undefined,
  propertyTitle: string
): string {
  return `Thanks ${firstName(contactName)} — yes, I found the *${propertyTitle}* you mean. Sharing the property details now 👇`;
}

export function buildPropertyInterestQuestion(): string {
  return "Do you have any specific questions about this property? Reply here — I've alerted the right agent, and they'll take it from here.";
}

export function buildUnresolvedPropertyInterestAck(
  contactName: string | null | undefined
): string {
  return `Thanks ${firstName(contactName)} — I've noted the property you mentioned. I couldn't safely pin it to one listing, so I've asked our team to confirm the right property and send you the details here.`;
}

function formatCatalogAmount(
  value: string | number,
  currency?: string
): string {
  const numeric = Number(value);
  const amount = Number.isFinite(numeric)
    ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(
        numeric
      )
    : String(value);
  return currency ? `${currency} ${amount}` : amount;
}

/** Turns Meta's structured catalog selection into readable inbox text. */
export function buildCatalogOrderMessage(
  order?: WhatsAppCatalogOrder | null
): string {
  const lines = ['Property selected from the WhatsApp catalog'];

  for (const item of order?.product_items || []) {
    const quantity = Number(item.quantity || 1);
    const price =
      item.item_price === undefined
        ? ''
        : ` · ${formatCatalogAmount(item.item_price, item.currency)}`;
    lines.push(
      `• ${item.product_retailer_id}${quantity > 1 ? ` × ${quantity}` : ''}${price}`
    );
  }

  if (order?.text?.trim()) lines.push(`Note: ${order.text.trim()}`);
  return lines.join('\n');
}
