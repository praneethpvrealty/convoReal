// ============================================================
// Owner property-details request — the message an agent sends a seller
// to collect everything a listing needs, and the promise of what comes
// back to the owner once it is live.
//
// This is an Engine template, not a Meta one. It is composed here and
// leaves either through the account's WhatsApp number (open 24-hour
// window) or as plain text the agent sends from their own WhatsApp, so
// nothing about it is submitted to Meta and the wording is free to
// change any day.
//
// Two things make it more than a canned paragraph:
//   1. The checklist follows the property's own type — a plot owner is
//      never asked for a BHK configuration or a building sanction.
//   2. The closing block states the owner digest's promise up front,
//      in the same STOP UPDATES / START UPDATES words the webhook
//      already parses, so an owner can opt out of the reply itself.
//
// Pure module (no I/O) so the copy is unit tested and the mobile app
// can mirror it verbatim.
// ============================================================

import { isLandType } from '@/lib/inventory/property-options';

export type OwnerDetailsSection =
  | 'identity'
  | 'construction'
  | 'price'
  | 'papers'
  | 'possession'
  | 'media';

/** Display order, and the order they are numbered in the message. */
export const OWNER_DETAILS_SECTIONS: OwnerDetailsSection[] = [
  'identity',
  'construction',
  'price',
  'papers',
  'possession',
  'media',
];

export const OWNER_DETAILS_SECTION_TITLES: Record<OwnerDetailsSection, string> =
  {
    identity: 'The property itself',
    construction: 'What is built on it',
    price: 'Your price and terms',
    papers: 'Papers',
    possession: 'Ownership and possession',
    media: 'Photos and location',
  };

/** The words the owner-digest webhook parses back off an inbound reply.
 *  Quoted in the message so the promise and the control are the same
 *  sentence — parseOwnerDigestCommand has to keep accepting both. */
export const DIGEST_PAUSE_COMMAND = 'STOP UPDATES';
export const DIGEST_RESUME_COMMAND = 'START UPDATES';

const IDENTITY_LAND = [
  'Exact address, with the site or survey number and the layout name',
  'Plot dimensions (east–west × north–south) and the total extent',
  'Which direction it faces, and the width of the road in front',
  'Corner site or intermediate',
  'What sits on all four boundaries today',
];

const IDENTITY_BUILT = [
  'Exact address, with the door or flat number',
  'Carpet, built-up and super built-up area',
  'Which floor it is on, and how many floors in the building',
  'Which direction it faces, and the width of the road in front',
  'Name of the project or building, and the year it was completed',
];

const CONSTRUCTION = [
  'Configuration — bedrooms, bathrooms, balconies',
  'Age of the construction and its condition today',
  'Covered and open car parks that come with it',
  'Furnishing, and what stays behind after the sale',
  'Water source, power backup and lift',
];

const PRICE_LAND = [
  'The price you have in mind, and whether there is room to negotiate',
  'Whether that is per square foot or for the whole site',
  'Whether it is all-inclusive, or registration and stamp duty are extra',
  'Any tax or khata dues still pending on it',
  'Any understanding you already have with another broker',
];

const PRICE_BUILT = [
  'The price you have in mind, and whether there is room to negotiate',
  'Whether that is all-inclusive, or registration and stamp duty are extra',
  'Any maintenance or association dues that run on it',
  'If it is rented today — the current rent and the deposit held',
  'Any understanding you already have with another broker',
];

const PAPERS_LAND = [
  'Mother deed and the current title deed',
  'Khata (A or B) and the latest tax paid receipt',
  'Encumbrance certificate for the last 13 years',
  'Survey sketch or tippan, and the conversion (DC) order if it applies',
  'Approved layout plan and the release order, for a layout site',
  'Any loan, lien or dispute standing on the property',
];

const PAPERS_BUILT = [
  'Sale deed and the mother deed',
  'Khata and the latest tax paid receipt',
  'Encumbrance certificate for the last 13 years',
  'Approved building plan and the sanction',
  'Occupancy or completion certificate, where one was issued',
  'RERA number if the project is registered, and the association NOC',
  'Any home loan currently running on it',
];

const POSSESSION = [
  'Everyone named on the title, and whether all of them have agreed to sell',
  'Who will sign — you, or a power-of-attorney holder',
  'Vacant, self-occupied or tenanted, and the notice period if tenanted',
  'How soon you can hand over after the agreement',
  'Who I should call to open the property for a site visit',
];

const MEDIA_LAND = [
  'Photos of the site from the road and from each boundary',
  'A short video walking the plot, if you have one',
  'A Google Maps pin of the exact location',
];

const MEDIA_BUILT = [
  'Photos from outside and inside, taken in daylight',
  'A short walk-through video, if you have one',
  'A Google Maps pin of the exact location',
];

/**
 * A raw parcel and a layout plot are both sold on title and extent, so
 * neither is asked what is built on it or for a building sanction.
 */
function isLand(propertyType?: string | null): boolean {
  return isLandType((propertyType || '').trim());
}

export function ownerDetailsSectionItems(
  section: OwnerDetailsSection,
  propertyType?: string | null
): string[] {
  const land = isLand(propertyType);
  switch (section) {
    case 'identity':
      return land ? IDENTITY_LAND : IDENTITY_BUILT;
    case 'construction':
      return CONSTRUCTION;
    case 'price':
      return land ? PRICE_LAND : PRICE_BUILT;
    case 'papers':
      return land ? PAPERS_LAND : PAPERS_BUILT;
    case 'possession':
      return POSSESSION;
    case 'media':
      return land ? MEDIA_LAND : MEDIA_BUILT;
  }
}

/** Sections that make sense for this property, in message order. */
export function defaultOwnerDetailsSections(
  propertyType?: string | null
): OwnerDetailsSection[] {
  return OWNER_DETAILS_SECTIONS.filter(
    (s) => s !== 'construction' || !isLand(propertyType)
  );
}

const HONORIFICS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'prof',
  'shri',
  'sri',
  'smt',
  'kum',
  'sir',
  'madam',
  'mx',
]);

/**
 * How an owner is addressed at the top of the message: any honorific
 * they are stored with, kept, plus the first name only — "Mr Nadeem
 * Ahmed" greets as "Mr Nadeem". Dropping the honorific the way the
 * share builder does reads as familiarity an agent has not earned with
 * a seller they are asking for title documents.
 */
export function respectfulName(name?: string | null): string {
  const tokens = (name || '').trim().split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const token of tokens) {
    const bare = token.replace(/\./g, '').toLowerCase();
    kept.push(token);
    if (!HONORIFICS.has(bare)) break;
  }
  return kept.join(' ') || 'there';
}

const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** Time-of-day greeting in IST, which is where every account sends
 *  from. Omitting `now` gives the neutral "Hello". */
export function ownerSalutation(now?: Date): string {
  if (!now) return 'Hello';
  const hour = Math.floor(
    ((now.getTime() / 60000 + IST_OFFSET_MINUTES) % 1440) / 60
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** What the owner calls their own property — a stored title is written
 *  for buyers, so the locality is appended when it is missing from it. */
export function ownerPropertyLabel(
  property?: {
    title?: string | null;
    sublocality?: string | null;
    city?: string | null;
  } | null
): string {
  const title = property?.title?.trim();
  const area = property?.sublocality?.trim() || property?.city?.trim();
  if (!title) return area ? `your property in ${area}` : '';
  if (area && !title.toLowerCase().includes(area.toLowerCase())) {
    return `${title}, ${area}`;
  }
  return title;
}

export interface OwnerDetailsRequestInput {
  ownerName?: string | null;
  /** From ownerPropertyLabel(); empty falls back to "your property". */
  propertyLabel?: string | null;
  propertyType?: string | null;
  /** Defaults to defaultOwnerDetailsSections(propertyType). */
  sections?: OwnerDetailsSection[];
  agentName?: string | null;
  agentPhone?: string | null;
  brandName?: string | null;
  /** Drives the salutation; omit for a plain "Hello". */
  now?: Date;
}

function opening(input: OwnerDetailsRequestInput): string {
  const agent = input.agentName?.trim();
  const brand = input.brandName?.trim();
  const label = input.propertyLabel?.trim() || 'your property';
  const who = agent
    ? `${agent} here${brand ? ` from ${brand}` : ''}.`
    : brand
      ? `${brand} here.`
      : '';
  return [who, `Thank you for considering us for ${label}.`]
    .filter(Boolean)
    .join(' ');
}

function signOff(input: OwnerDetailsRequestInput): string {
  return [input.agentName?.trim(), input.agentPhone?.trim()]
    .filter(Boolean)
    .join('\n');
}

export function buildOwnerDetailsRequestMessage(
  input: OwnerDetailsRequestInput
): string {
  const sections = (
    input.sections?.length
      ? input.sections
      : defaultOwnerDetailsSections(input.propertyType)
  ).filter((s) => OWNER_DETAILS_SECTIONS.includes(s));

  const checklist = sections.map((section, i) => {
    const items = ownerDetailsSectionItems(section, input.propertyType)
      .map((item) => `• ${item}`)
      .join('\n');
    return `*${i + 1}. ${OWNER_DETAILS_SECTION_TITLES[section]}*\n${items}`;
  });

  return [
    `${ownerSalutation(input.now)} ${respectfulName(input.ownerName)} 🙏`,
    opening(input),
    'Before I take this to buyers, I need the full picture from your side. Send whatever you have ready now — the rest can follow.',
    ...checklist,
    'Everything can come right here on this chat — photos, PDFs, or a voice note if that is easier to send.',
    [
      '*What you will get back*',
      'Once your property is live with us, this same number keeps you posted. You will not have to call and ask:',
      '• Every buyer who enquires about it',
      '• Buyers we shortlist and take it to',
      '• Site visits — scheduled, and how each one went',
      '• Offers, and anything discussed on your behalf',
    ].join('\n'),
    `_These updates come from this business number. Reply ${DIGEST_PAUSE_COMMAND} to pause them, ${DIGEST_RESUME_COMMAND} to switch them back on._`,
    signOff(input),
  ]
    .filter(Boolean)
    .join('\n\n');
}
