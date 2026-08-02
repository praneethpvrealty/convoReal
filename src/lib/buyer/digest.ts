// ============================================================
// Buyer match digest — pure message building and selection.
//
// The buyer twin of src/lib/owners/owner-digest.ts's text layer: what
// a buyer reads on WhatsApp when listings come up that fit the brief
// they gave an agency. Ranking happens in matches-ranking.ts, delivery
// in digest-sender.ts; this module decides what is worth saying and
// says it. Pure (no I/O) so the copy and the repeat-suppression rules
// are unit tested.
// ============================================================

import type { Property } from '@/types';
import type { CuratedMatch } from './matches-ranking';

/** Listings per digest. More than this reads as a catalog dump and
 *  gets ignored; fewer feels like the agency isn't working. */
export const MAX_DIGEST_MATCHES = 3;

/** How far back the "don't send this listing again" memory reaches. A
 *  buyer who ignored a listing last week doesn't want it every week;
 *  after a month it's fair to resurface as the market moves. */
export const REPEAT_SUPPRESSION_DAYS = 30;

function compactINR(value: number): string {
  if (value >= 1_00_00_000) {
    const cr = value / 1_00_00_000;
    return `₹${cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(2).replace(/0$/, '')} Cr`;
  }
  if (value >= 1_00_000) {
    const l = value / 1_00_000;
    return `₹${l % 1 === 0 ? l.toFixed(0) : l.toFixed(1)} L`;
  }
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function digestPriceLabel(property: Property): string | null {
  if (property.listing_type === 'Rent') {
    return property.rent_per_month
      ? `${compactINR(Number(property.rent_per_month))}/month`
      : null;
  }
  return property.price ? compactINR(Number(property.price)) : null;
}

function specsLine(property: Property): string {
  const bits: string[] = [];
  const where =
    [property.sublocality?.trim(), property.city?.trim()].filter(Boolean).join(', ') ||
    property.location?.trim();
  if (where) bits.push(where);
  if (property.bedrooms) bits.push(`${property.bedrooms} BHK`);
  if (property.area_sqft) {
    bits.push(`${Number(property.area_sqft).toLocaleString('en-IN')} ${property.area_unit || 'Sq.Ft.'}`);
  } else if (property.land_area) {
    bits.push(
      `${Number(property.land_area).toLocaleString('en-IN')} ${property.land_area_unit || 'Sq.Ft.'}`
    );
  }
  return bits.join(' · ');
}

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || 'there';
}

/**
 * Drops listings this buyer has already been sent. The caller supplies
 * the ids from the digest ledger — a match the buyer ignored should not
 * come back tomorrow just because it still scores well.
 */
export function selectUnsentMatches(
  matches: CuratedMatch[],
  alreadySentIds: Iterable<string>,
  limit = MAX_DIGEST_MATCHES
): CuratedMatch[] {
  const sent = new Set(alreadySentIds);
  return matches.filter((m) => !sent.has(m.property.id)).slice(0, limit);
}

export interface DigestMessageArgs {
  contactName: string | null | undefined;
  matches: CuratedMatch[];
  /** Deep link to the buyer's own matches page. */
  portalUrl: string;
}

/**
 * The free-form digest, used when the buyer's 24-hour window is open.
 * Always ends with the opt-out, because a message a buyer can't stop is
 * a message we shouldn't send.
 */
export function buildMatchDigestMessage(args: DigestMessageArgs): string {
  const { matches } = args;
  const heading =
    matches.length === 1
      ? `Hi ${firstName(args.contactName)} 👋\n\nOne new listing matches what you're looking for:`
      : `Hi ${firstName(args.contactName)} 👋\n\n${matches.length} new listings match what you're looking for:`;

  const items = matches.map((match, index) => {
    const price = digestPriceLabel(match.property);
    const lines = [`${index + 1}. *${match.property.title}*${price ? ` — ${price}` : ''}`];
    const specs = specsLine(match.property);
    if (specs) lines.push(`   ${specs}`);
    if (match.reasons.length) lines.push(`   ✓ ${match.reasons.slice(0, 3).join(' · ')}`);
    return lines.join('\n');
  });

  return [
    heading,
    '',
    items.join('\n\n'),
    '',
    `See them all and shortlist what you like:\n${args.portalUrl}`,
    '',
    'Reply STOP ALERTS to pause these.',
  ].join('\n');
}

/**
 * Asked once of a buyer whose consent is still 'pending'. Never sent
 * twice — the caller records buyer_alerts_consent_requested_at.
 */
export function buildConsentRequestMessage(args: {
  contactName: string | null | undefined;
  matchCount: number;
  agencyName?: string | null;
}): string {
  const who = args.agencyName?.trim() ? ` from ${args.agencyName.trim()}` : '';
  const count =
    args.matchCount === 1
      ? 'a listing that matches'
      : `${args.matchCount} listings that match`;
  return (
    `Hi ${firstName(args.contactName)} 👋\n\n` +
    `We${who} have ${count} what you're looking for. ` +
    `Want them on WhatsApp as they come up?\n\n` +
    `Reply *START ALERTS* and we'll send them.\n` +
    `Reply *STOP ALERTS* and we won't ask again.`
  );
}

/** Reply to an on-demand "MATCHES" request when nothing fits yet. */
export function buildNoMatchesMessage(contactName: string | null | undefined): string {
  return (
    `Hi ${firstName(contactName)} — nothing in our inventory fits your brief right now. ` +
    `The moment something does, you'll hear from us here. ` +
    `Reply with what's changed (budget, area, type) and we'll re-run the search.`
  );
}

// Prefixes repeat ("show my matches"), so the group is starred rather
// than optional. The length guard above keeps this from swallowing a
// sentence that merely mentions the word.
const MATCHES_COMMAND =
  /^((show|send|see|get|my|any|new)\s+)*(match|matches|property|properties|listing|listings)(\s+for\s+me)?[?.!]*$/i;

/**
 * "MATCHES" / "show my matches" / "any new listings?" in the buyer's
 * chat. Same chat-as-control-panel pattern as STOP/START ALERTS: the
 * reply is free-form inside the window they just opened by texting, so
 * it needs no template.
 */
export function parseBuyerMatchesCommand(text: string | null | undefined): boolean {
  if (!text) return false;
  const cleaned = text.trim().toLowerCase();
  if (cleaned.length > 40) return false;
  return MATCHES_COMMAND.test(cleaned);
}
