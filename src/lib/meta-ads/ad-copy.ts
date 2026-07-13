// ============================================================
// Ad copy generation — pure helpers for the AI ad-copy route.
//
// Meta truncates ad text at hard limits, so whatever the model
// returns is parsed and clamped to safe lengths before it ever
// reaches a creative. Kept transport-free so the parsing/clamping is
// unit-testable without a Gemini call.
// ============================================================

/** Meta's practical display limits for a single-image link ad. */
export const AD_COPY_LIMITS = {
  primaryText: 125,
  headline: 40,
  description: 30,
} as const;

export interface AdCopy {
  primaryText: string;
  headline: string;
  description: string;
}

interface PropertyForCopy {
  title: string;
  type?: string | null;
  location?: string | null;
  city?: string | null;
  listing_type?: 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit' | null;
  price?: number | null;
  rent_per_month?: number | null;
  bedrooms?: number | null;
  area_sqft?: number | null;
  features?: string[] | null;
  nearby_highlights?: string[] | null;
  owner_share_percent?: number | null;
  builder_share_percent?: number | null;
}

/** System instruction: housing-ad-safe, no phone numbers, length-aware. */
export const AD_COPY_SYSTEM_PROMPT =
  'You are a real estate performance-marketing copywriter creating a Click-to-WhatsApp ad for ONE property. ' +
  'Return STRICT JSON only — no markdown, no code fences — with exactly these keys: ' +
  '"primary_text" (<=125 chars), "headline" (<=40 chars), "description" (<=30 chars). ' +
  'Rules: mention the location and 1-2 strongest selling points and a price/rent band if given. ' +
  'End the primary text with a soft call to action like "Message us on WhatsApp for details". ' +
  'Do NOT use ALL-CAPS. Do NOT include phone numbers, email addresses, or URLs (the ad button handles contact). ' +
  'Never use language that discriminates on religion, caste, family status, gender, or similar — housing-ad rules. ' +
  'Do not invent amenities or facts not provided.';

function inr(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(n % 10000000 === 0 ? 0 : 2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

/** Builds the grounding prompt the model sees for a property. */
export function buildAdCopyPrompt(p: PropertyForCopy): string {
  const lines: string[] = [`Title: ${p.title}`];
  if (p.type) lines.push(`Type: ${p.type}`);
  const loc = [p.location, p.city].filter(Boolean).join(', ');
  if (loc) lines.push(`Location: ${loc}`);
  if (p.bedrooms) lines.push(`Bedrooms: ${p.bedrooms} BHK`);
  if (p.area_sqft) lines.push(`Area: ${p.area_sqft} sq.ft.`);
  if (p.listing_type === 'Rent' || p.listing_type === 'Built to Suit') {
    if (p.rent_per_month) lines.push(`Rent: ${inr(p.rent_per_month)}/month`);
  } else if (p.listing_type === 'JV/JD') {
    if (p.owner_share_percent && p.builder_share_percent) {
      lines.push(`Deal: Joint Venture/Development, ${p.owner_share_percent}:${p.builder_share_percent} owner:builder share`);
    } else {
      lines.push('Deal: Joint Venture/Development opportunity');
    }
  } else if (p.price) {
    lines.push(`Price: ${inr(p.price)}`);
  }
  if (p.features?.length) lines.push(`Features: ${p.features.slice(0, 5).join(', ')}`);
  if (p.nearby_highlights?.length) lines.push(`Nearby: ${p.nearby_highlights.slice(0, 3).join(', ')}`);
  return `Property details:\n${lines.join('\n')}\n\nReturn the ad copy JSON now.`;
}

function clampField(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length <= max) return s;
  // Trim to the last word boundary within the limit where possible.
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Parses the model's response into clamped ad copy. Tolerates code
 * fences and surrounding prose by extracting the first {...} block.
 * Returns null when no usable primary_text/headline could be found —
 * the caller then refunds credits and surfaces an error rather than
 * launching an ad with empty copy.
 */
export function parseAdCopy(raw: string): AdCopy | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }

  const primaryText = clampField(obj.primary_text, AD_COPY_LIMITS.primaryText);
  const headline = clampField(obj.headline, AD_COPY_LIMITS.headline);
  const description = clampField(obj.description, AD_COPY_LIMITS.description);

  if (!primaryText || !headline) return null;
  return { primaryText, headline, description };
}
