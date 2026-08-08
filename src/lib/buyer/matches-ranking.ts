// ============================================================
// Buyer portal — match ranking. Pure module (no I/O), unit tested.
//
// The Match Radar engine (src/lib/matching.ts) answers "which of my
// contacts want this property"; the buyer's own portal asks the
// transpose, "which properties fit me". Rather than write a second
// scoring model that could drift from the agent-facing one, this runs
// the SAME engine per property with a single-contact list and inverts
// the result. One source of truth for what counts as a match, so what
// a buyer sees can never disagree with what their agent sees.
// ============================================================

import type { Contact, Property } from '@/types';
import { getMatchingContacts, type MatchDetails } from '@/lib/matching';

/**
 * Whether this contact has told anyone what they're looking for.
 * Nothing buyer-facing should run without it: ranking a pool against
 * an empty brief produces noise, not matches.
 */
export function hasBuyerBrief(contact: Contact): boolean {
  return Boolean(
    contact.min_budget ||
      contact.max_budget ||
      contact.areas_of_interest?.length ||
      contact.projects_of_interest?.length ||
      contact.property_interests?.length ||
      contact.min_roi ||
      contact.requirements?.trim()
  );
}

export interface CuratedMatch {
  property: Property;
  score: number;
  details: MatchDetails;
  reasons: string[];
}

/** Score below which a listing isn't worth putting in front of a
 *  buyer — the same floor the Deal Mode sweep uses. */
export const MIN_BUYER_MATCH_SCORE = 60;

export function matchReasons(details: MatchDetails): string[] {
  const reasons: string[] = [];
  // Leads, and takes the place of the location line: a named-project
  // hit forces location to 'match' in the engine whether or not the
  // buyer's stated areas cover the property, so "In your area" would be
  // a claim nothing actually checked.
  if (details.project === 'match') reasons.push('Project you asked for');
  if (details.type === 'match') reasons.push('Type you asked for');
  else if (details.type === 'partial') reasons.push('Same category');
  if (details.project !== 'match') {
    if (details.location === 'match') reasons.push('In your area');
    else if (details.location === 'partial')
      reasons.push(details.locationKm != null ? `~${details.locationKm} km from your area` : 'Same city');
  }
  if (details.budget === 'match') reasons.push('Within budget');
  else if (details.budget === 'partial') reasons.push('Just off budget');
  if (details.bhk === 'match') reasons.push('BHK fits');
  if (details.roi === 'match') reasons.push('Meets your yield');
  return reasons;
}

/**
 * Ranks a pool of listings for one buyer, best first. Ties break on
 * price ascending so the cheapest equally-good option leads.
 */
export function curateForBuyer(
  properties: Property[],
  contact: Contact,
  opts: { limit?: number; minScore?: number } = {}
): CuratedMatch[] {
  const minScore = opts.minScore ?? MIN_BUYER_MATCH_SCORE;
  const matches: CuratedMatch[] = [];

  for (const property of properties) {
    let result;
    try {
      result = getMatchingContacts(property, [contact])[0];
    } catch {
      continue;
    }
    if (!result || result.score < minScore) continue;
    matches.push({
      property,
      score: result.score,
      details: result.details,
      reasons: matchReasons(result.details),
    });
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return priceOf(a.property) - priceOf(b.property);
  });

  return opts.limit ? matches.slice(0, opts.limit) : matches;
}

function priceOf(property: Property): number {
  if (property.listing_type === 'Rent') return Number(property.rent_per_month || 0);
  return Number(property.price || 0);
}

/**
 * Merges curated lists from several agencies into one feed. A buyer
 * registered with two brokerages that both list the same property
 * should see it once, at its best score.
 */
export function mergeCuratedFeeds(feeds: CuratedMatch[][], limit: number): CuratedMatch[] {
  const best = new Map<string, CuratedMatch>();
  for (const feed of feeds) {
    for (const match of feed) {
      const existing = best.get(match.property.id);
      if (!existing || match.score > existing.score) best.set(match.property.id, match);
    }
  }
  return [...best.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return priceOf(a.property) - priceOf(b.property);
    })
    .slice(0, limit);
}
