// ============================================================
// Requirement share links — the interactive half of co-broker
// sharing (migration 210).
//
// src/lib/requirements/share.ts renders a brief as text; a link makes
// that text answerable. It rides the share message as /req/<token>,
// where the co-broker can submit a matching listing through the /list
// funnel or jump to the account's engine WhatsApp quoting the REQ-XXXX
// reference. The reference doubles as the inbound trigger: a live link
// is what authorises the webhook to reveal the brief and open a
// listing intake session for it.
//
// A link only ever reveals ONE brief, at the mode frozen when it was
// minted. It expires, can be revoked, and every open is counted —
// mirroring property share grants.
//
// Pure module (no I/O) so token, expiry and reference-extraction rules
// are unit tested. Server-side resolution lives in respond.ts.
// ============================================================

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Closed TTL set, matching property share grants: trivial to
 *  validate, and no honest reason for a link that outlives a deal
 *  cycle. */
export const REQUIREMENT_LINK_TTL_CHOICES = [
  { key: '24h', label: '24 hours', ms: DAY_MS },
  { key: '7d', label: '7 days', ms: 7 * DAY_MS },
  { key: '30d', label: '30 days', ms: 30 * DAY_MS },
] as const;

export type RequirementLinkTtlKey =
  (typeof REQUIREMENT_LINK_TTL_CHOICES)[number]['key'];

export const REQUIREMENT_LINK_TTL_MS = 7 * DAY_MS;

/** Resolves a caller-supplied choice, falling back to the default —
 *  an unknown key must not mint a longer-lived link than asked for. */
export function requirementLinkTtlMs(key: string | null | undefined): number {
  const choice = REQUIREMENT_LINK_TTL_CHOICES.find((c) => c.key === key);
  return choice ? choice.ms : REQUIREMENT_LINK_TTL_MS;
}

export interface RequirementShareLink {
  id: string;
  account_id: string;
  contact_id: string;
  created_by: string | null;
  token: string;
  mode: 'full' | 'masked';
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

export function mintRequirementLinkToken(
  ttlMs: number = REQUIREMENT_LINK_TTL_MS
): {
  token: string;
  expiresAt: string;
} {
  const raw =
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '');
  return {
    token: raw.substring(0, 48),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
}

export function isRequirementLinkLive(
  link: Pick<RequirementShareLink, 'expires_at' | 'revoked_at'>,
  now: Date = new Date()
): boolean {
  if (link.revoked_at) return false;
  return new Date(link.expires_at) > now;
}

// requirementReference() (share.ts) derives REQ-XXXX from the first
// four hex chars of the contact UUID, so the body is hex — anchored to
// the prefix, a 5th trailing hex char fails the boundary and the
// candidate is rejected rather than truncated.
const REQ_REF_RE = /\bREQ-([0-9A-F]{4})\b/i;

/** Extracts a normalised REQ-XXXX reference from an inbound message,
 *  or null when it doesn't carry one. */
export function extractRequirementReference(
  text: string | null | undefined
): string | null {
  if (!text) return null;
  const m = text.match(REQ_REF_RE);
  return m ? `REQ-${m[1].toUpperCase()}` : null;
}

export function requirementLinkPath(token: string): string {
  return `/req/${token}`;
}
