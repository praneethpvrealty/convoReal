// ============================================================
// Where the portals disagree with us.
//
// A property advertised on MagicBricks, 99acres and Housing is the
// same plot described four times, and the copies drift: one was posted
// before a survey corrected the extent, another still carries last
// quarter's price. Buyers read the portals and us side by side —
// "It says 4000sqft in magicbricks. Is it the same one???" — and until
// now the answer was "we don't have information about other listings",
// which is untrue: portal_import_items has carried the portal's own
// price, area and bedroom figures since migration 124. Nothing read
// them back.
//
// This compares the two and names the difference. It does NOT pick a
// winner: which number is right is a question about the property, not
// about the data, and only the agent can settle it. Everything here is
// pure so both the buyer-facing answer and the agent's calibration
// list come from one comparison.
// ============================================================

import type { PortalKey } from '@/lib/portals/post-kit';
import { PORTALS } from '@/lib/portals/post-kit';

/** One portal's copy of the figures, as harvested. */
export interface PortalListingFigures {
  portal: PortalKey;
  listingUrl?: string | null;
  price?: number | null;
  areaSqft?: number | null;
  bedrooms?: number | null;
}

/** The Engine-side figures a portal copy is checked against. */
export interface ReconcilableProperty {
  price?: number | null;
  area_sqft?: number | null;
  land_area?: number | null;
  land_area_unit?: string | null;
  bedrooms?: number | null;
}

export type ReconciledField = 'price' | 'area_sqft' | 'bedrooms';

export interface PortalDiscrepancy {
  portal: PortalKey;
  portalLabel: string;
  listingUrl: string | null;
  field: ReconciledField;
  ours: number;
  theirs: number;
  /** Fractional gap against our figure, for ranking. */
  drift: number;
}

/**
 * How far apart two figures may sit and still count as the same
 * number. Portals round and re-unit — 4199 posted as 4200 is not a
 * discrepancy worth waking an agent for. It has to stay tight: the
 * 4000-vs-4200 that prompted this is a 4.8% gap, and a tolerance
 * generous enough to swallow that would swallow the whole feature.
 */
export const DRIFT_TOLERANCE = 0.01;

function drift(ours: number, theirs: number): number {
  if (ours === 0) return theirs === 0 ? 0 : 1;
  return Math.abs(theirs - ours) / Math.abs(ours);
}

/**
 * Our area figure for comparison. A plot is listed on the portals by
 * its extent, so `land_area` is the like-for-like number when it is
 * held in Sq.Ft.; a land area in acres or guntas is a different unit
 * and comparing it to a portal's sqft would manufacture a discrepancy
 * on every plot we own.
 */
export function comparableAreaSqft(
  property: ReconcilableProperty
): number | null {
  if (property.area_sqft) return property.area_sqft;
  const unit = (property.land_area_unit || '').trim().toLowerCase();
  if (property.land_area && (unit === 'sq.ft.' || unit === 'sqft' || unit === 'sq ft')) {
    return property.land_area;
  }
  return null;
}

/**
 * Every field on which a portal's copy differs from ours, worst first.
 * A field either side has not stated is not a disagreement — it is a
 * gap, and reporting it as drift would bury the real ones.
 */
export function findPortalDiscrepancies(
  property: ReconcilableProperty,
  listings: PortalListingFigures[]
): PortalDiscrepancy[] {
  const ourArea = comparableAreaSqft(property);
  const out: PortalDiscrepancy[] = [];

  for (const listing of listings) {
    const pairs: [ReconciledField, number | null | undefined, number | null | undefined][] = [
      ['price', property.price, listing.price],
      ['area_sqft', ourArea, listing.areaSqft],
      ['bedrooms', property.bedrooms, listing.bedrooms],
    ];

    for (const [field, ours, theirs] of pairs) {
      if (!ours || !theirs) continue;
      // Bedrooms are a count: 2 is not 3, and no rounding excuses it.
      const gap = drift(ours, theirs);
      if (field === 'bedrooms' ? ours === theirs : gap <= DRIFT_TOLERANCE) continue;

      out.push({
        portal: listing.portal,
        portalLabel: PORTALS[listing.portal]?.label ?? listing.portal,
        listingUrl: listing.listingUrl ?? null,
        field,
        ours,
        theirs,
        drift: gap,
      });
    }
  }

  return out.sort((a, b) => b.drift - a.drift);
}

const PORTAL_MENTION: Record<PortalKey, RegExp> = {
  magicbricks: /\bmagic\s?bricks\b/i,
  '99acres': /\b99\s?acres\b/i,
  housing: /\bhousing(\.com)?\b/i,
};

/** The portal a buyer named in their question, if any. */
export function portalFromQuestion(question: string): PortalKey | null {
  const text = question || '';
  for (const [key, pattern] of Object.entries(PORTAL_MENTION) as [PortalKey, RegExp][]) {
    if (pattern.test(text)) return key;
  }
  return null;
}
