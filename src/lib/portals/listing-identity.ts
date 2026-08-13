// ============================================================
// Portal listing identity — the portal's own id for an ad, read
// out of the listing URL the agent saves at "Mark as Posted" and
// out of the lead emails the portals send. Holding the same id on
// both sides turns lead attribution from a fuzzy score over the
// account's inventory into an exact lookup on
// property_portal_listings. Pure functions — no network.
// ============================================================

import type { PortalKey } from './post-kit';

/** Portal ad ids are long digit runs; anything shorter is a page
 *  number, a pagination cursor or a locality code. */
const ID_RE: Record<PortalKey, RegExp[]> = {
  '99acres': [
    /\/(?:npxid-)?([a-z]?\d{6,})(?:$|[?#/])/i,
    /[?&]id=([a-z]?\d{6,})/i,
    /spid[=-]([a-z0-9]{6,})/i,
  ],
  magicbricks: [
    /pdpid-(\d{6,})/i,
    /[?&]pdpid=(\d{6,})/i,
    /-pd-(\d{6,})/i,
    /\/propertyDetails\/[^?]*?(\d{8,})/i,
  ],
  // Query form ONLY. Housing's URLs otherwise carry an opaque slug, and
  // a slug pattern here matched first and won: a pasted listing URL
  // stored "abc123def" as the ad id, while every Housing lead email
  // quotes a numeric "Property ID: 20749829". The two could never meet,
  // so the mapping resolved nothing and failed silently — the agent saw
  // a saved listing URL and no reason to doubt it. Returning null is the
  // honest answer; the dialog asks for the id instead.
  housing: [/[?&]property_?id=(\d{5,})/i],
};

/** Housing's URLs carry an opaque slug rather than the numeric id its
 *  lead emails quote, so only the query form is trustworthy there. */
export function parseListingIdFromUrl(
  portal: PortalKey,
  url?: string | null
): string | null {
  if (!url) return null;
  const clean = url.trim();
  if (!clean) return null;
  for (const re of ID_RE[portal]) {
    const m = clean.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** The id the portal quotes in its lead email. Each portal words it
 *  differently, and only these labelled forms are safe to trust — a
 *  bare number in the body is as likely to be a phone or a price. */
const LEAD_ID_RE: Record<PortalKey, RegExp[]> = {
  // MagicBricks writes it mid-sentence ("your Property, ID 79221031:"),
  // so the separator between the words and the digits is optional.
  '99acres': [
    /(?:property|listing|ad)[,\s]*(?:id|code)\s*[:\-|#]?\s*([a-z]?\d{6,})/i,
    /\bnpxid[:\-\s]*([a-z]?\d{6,})/i,
  ],
  magicbricks: [
    /(?:property|listing|ad)[,\s]*(?:id|code)\s*[:\-|#]?\s*(\d{6,})/i,
    /\bpdpid[:\-\s]*(\d{6,})/i,
  ],
  housing: [/property\s*id\s*[:\-|]\s*(\d{5,})/i],
};

export function parseListingIdFromLead(
  portal: PortalKey | null,
  text?: string | null
): string | null {
  if (!portal || !text) return null;
  for (const re of LEAD_ID_RE[portal]) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Lead emails name their portal in prose ("99acres", "Magicbricks",
 *  "Housing.com"); email_sync_logs and contacts store the same wording. */
export function portalKeyFromSource(source?: string | null): PortalKey | null {
  const s = (source || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.includes('99acres')) return '99acres';
  if (s.includes('magicbrick')) return 'magicbricks';
  if (s.includes('housing')) return 'housing';
  return null;
}

/** Scheme, host case, `www.`, trailing slash and tracking params all
 *  vary between the URL an agent pastes and the one a portal mails, so
 *  a URL match has to run on this form. Mirrors the normaliser in
 *  `src/lib/portal-import/listing-matcher.ts`. */
export function normalizeListingUrl(url?: string | null): string | null {
  if (!url) return null;
  const clean = url.trim();
  if (!clean) return null;
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(clean) ? clean : `https://${clean}`
    );
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return clean.toLowerCase().replace(/\/+$/, '');
  }
}
