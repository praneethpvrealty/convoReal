import type { Property } from '@/types';

/**
 * Prefill generator for the "Share via Email" draft — pure, transport-
 * free text builder matching the structured format agents already use
 * when emailing land/JV opportunities by hand (land extension, land use,
 * ownership, deal proposal, location, sketch, remarks). The caller opens
 * this in the agent's own mail client; nothing here sends email.
 */

export type ShareEmailProperty = Pick<
  Property,
  | 'id' | 'is_published'
  | 'title' | 'type' | 'listing_type' | 'price' | 'rent_per_month' | 'maintenance'
  | 'location' | 'sublocality' | 'city' | 'google_map_link' | 'nearby_highlights'
  | 'land_area' | 'land_area_unit' | 'land_zone' | 'land_use_zoning' | 'ownership_status'
  | 'deal_remarks' | 'jv_structure' | 'owner_share_percent' | 'builder_share_percent'
  | 'goodwill_amount' | 'documents' | 'property_code' | 'images'
>;

/** A wall of storage URLs reads terribly and mailto: links choke on very
 *  long bodies — inline only a few, then point at the public showcase
 *  page (when published) or note the rest instead of dropping them
 *  silently. */
const IMAGE_LINK_CAP = 3;
const DOCUMENT_LINK_CAP = 5;

/** Property.documents entries are JSON strings of {url, title}. */
function parseDocument(raw: string, index: number): { title: string; url: string | null } {
  try {
    const parsed = JSON.parse(raw) as { url?: string; title?: string };
    return { title: parsed.title?.trim() || `Document ${index + 1}`, url: parsed.url?.trim() || null };
  } catch {
    return { title: `Document ${index + 1}`, url: null };
  }
}

export interface PropertyShareEmailOptions {
  /** First names of the selected recipients, used to build the greeting line. */
  recipientNames?: string[];
  agentName?: string | null;
  agentPhone?: string | null;
  /** Site origin (e.g. https://convoreal.com) for the public showcase link
   *  used when a published listing has more photos than get inlined. */
  showcaseBaseUrl?: string | null;
}

export interface PropertyShareEmailContent {
  subject: string;
  body: string;
}

function inr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

function formatLandExtent(p: ShareEmailProperty): string | null {
  if (!p.land_area) return null;
  return `${p.land_area} ${p.land_area_unit || 'Sq.Ft.'}`;
}

function dealTypeLabel(listingType: string): string {
  switch (listingType) {
    case 'JV/JD':
      return 'JD Opportunity';
    case 'Built to Suit':
      return 'Built to Suit Opportunity';
    case 'Rent':
      return 'Rental Opportunity';
    default:
      return 'Outright Opportunity';
  }
}

/** Builds the subject/body of a prefilled "Share via Email" draft for one property. */
export function buildPropertyShareEmailContent(
  property: ShareEmailProperty,
  opts: PropertyShareEmailOptions = {}
): PropertyShareEmailContent {
  const listingType = property.listing_type || 'Sale';
  const extent = formatLandExtent(property);
  const locationLabel = [property.sublocality, property.city].filter(Boolean).join(', ') || property.location || '';

  const subjectParts = [dealTypeLabel(listingType)];
  if (extent) subjectParts.push(extent);
  if (locationLabel) subjectParts.push(locationLabel);
  const subject = subjectParts.join(' || ');

  const greetingNames = (opts.recipientNames || []).filter(Boolean);
  const greeting = greetingNames.length > 0 ? `Hi ${greetingNames.join(' and ')},` : 'Hi,';

  const lines: string[] = [greeting, '', 'Greetings of the day!', '', 'Please find the details below :', ''];

  if (extent) lines.push(`Land extension - ${extent}`);

  const landUse = property.land_use_zoning || property.land_zone || null;
  if (landUse) lines.push(`Land use - ${landUse}`);

  if (property.ownership_status) lines.push(`Ownership - ${property.ownership_status}`);

  if (listingType === 'JV/JD') {
    const hasShare = !!(property.owner_share_percent && property.builder_share_percent);
    const proposal = hasShare
      ? `${property.owner_share_percent}:${property.builder_share_percent} share (owner:builder)${property.jv_structure ? `, ${property.jv_structure}` : ''}${property.goodwill_amount ? `, Goodwill ${inr(property.goodwill_amount)}` : ''}`
      : 'To be discussed.';
    lines.push(`JD proposal - ${proposal}`);
  } else if (listingType === 'Rent' || listingType === 'Built to Suit') {
    if (property.rent_per_month) {
      lines.push(
        `Proposal - ${inr(property.rent_per_month)}/month${property.maintenance ? ` + ${inr(property.maintenance)} maintenance` : ''}`
      );
    }
  } else if (property.price) {
    lines.push(`Proposal - ${inr(property.price)}`);
  }

  if (property.google_map_link) {
    lines.push(`Location: ${property.google_map_link}`);
  } else if (locationLabel) {
    lines.push(`Location: ${locationLabel}`);
  }

  if (property.nearby_highlights && property.nearby_highlights.length > 0) {
    lines.push(`Landmark: ${property.nearby_highlights[0]}`);
  }

  const showcaseUrl =
    property.is_published && opts.showcaseBaseUrl && property.id
      ? `${opts.showcaseBaseUrl.replace(/\/$/, '')}/?property_id=${property.id}`
      : null;

  const images = (property.images || []).filter(Boolean);
  if (images.length > 0) {
    lines.push('', 'Photos:');
    images.slice(0, IMAGE_LINK_CAP).forEach((url, i) => lines.push(`${i + 1}. ${url}`));
    if (images.length > IMAGE_LINK_CAP) {
      lines.push(
        showcaseUrl
          ? `All ${images.length} photos & full details: ${showcaseUrl}`
          : `...plus ${images.length - IMAGE_LINK_CAP} more photo(s) available on request.`
      );
    }
  }

  const documents = (property.documents || [])
    .map((raw, i) => parseDocument(raw, i))
    .filter((d): d is { title: string; url: string } => !!d.url);
  if (documents.length > 0) {
    lines.push('', documents.length === 1 ? 'Sketch:' : 'Documents:');
    documents.slice(0, DOCUMENT_LINK_CAP).forEach((d, i) => lines.push(`${i + 1}. ${d.title} - ${d.url}`));
    if (documents.length > DOCUMENT_LINK_CAP) {
      lines.push(`...plus ${documents.length - DOCUMENT_LINK_CAP} more document(s) available on request.`);
    }
  }

  if (property.deal_remarks) lines.push(`Remarks: ${property.deal_remarks}`);

  lines.push('', 'Please let me know if you have any questions.', '', 'Regards,');
  if (opts.agentName) lines.push(opts.agentName);
  if (opts.agentPhone) lines.push(opts.agentPhone);

  return { subject, body: lines.join('\n') };
}

// ── AI drafting (used by /api/ai/share-email) ───────────────────────

/** System instruction for the credit-metered "Draft with AI" rewrite. */
export const SHARE_EMAIL_SYSTEM_PROMPT =
  'You are an expert real estate deal-maker writing a B2B email to brokers, builders, or investors in the Indian market. ' +
  'You are given a baseline draft for ONE property. Rewrite it into a polished, professional, concise email. ' +
  'Rules:\n' +
  '1. PLAIN TEXT only — no markdown, no HTML, no bullets other than simple hyphens.\n' +
  '2. Keep every fact and every URL from the baseline EXACTLY as given. Never invent, estimate, or embellish facts (no invented approvals, dimensions, or prices).\n' +
  '3. Keep the structured key-facts block (Land extension / Land use / Ownership / proposal / Location / Photos / Sketch / Remarks) — polish the prose around it, don\'t bury the facts in paragraphs.\n' +
  '4. Keep the greeting names and the sign-off name/phone from the baseline.\n' +
  '5. Business-appropriate tone for high-value Indian real estate deals: courteous, direct, no hype words, no emojis.\n' +
  '6. Return STRICT JSON only — no code fences — with exactly these keys: "subject" (string, keep the "X || Y || Z" convention), "body" (string with \\n line breaks).';

/** Builds the user prompt for the AI rewrite from the deterministic draft. */
export function buildShareEmailAiPrompt(
  property: ShareEmailProperty,
  opts: PropertyShareEmailOptions = {}
): string {
  const { subject, body } = buildPropertyShareEmailContent(property, opts);
  return (
    `Property type: ${property.type || 'Unknown'} (${property.listing_type || 'Sale'})\n\n` +
    `Baseline draft:\nSubject: ${subject}\n\n${body}\n\n` +
    'Rewrite this email now and return the JSON.'
  );
}

/** Parses the model's JSON response. Tolerates code fences and stray
 *  prose by extracting the first {...} block. Returns null when no
 *  usable subject/body could be recovered — callers refund credits. */
export function parseAiShareEmail(raw: string): PropertyShareEmailContent | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { subject?: unknown; body?: unknown };
    const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : '';
    const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
    if (!subject || !body) return null;
    return { subject, body };
  } catch {
    return null;
  }
}
