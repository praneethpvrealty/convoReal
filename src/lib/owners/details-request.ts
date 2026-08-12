// ============================================================
// Owner property-details request — the first message an agent sends a
// seller, and the one that moves the relationship onto the business
// number.
//
// This is an Engine template, not a Meta one. It is composed here,
// edited before it goes, and never submitted for approval, so the
// wording is free to change any day.
//
// Four rules shape it, and each one came from how the deal actually
// runs:
//
//   1. It goes from the AGENT'S OWN WhatsApp. First contact with a
//      seller happens on the phone they already answer — there is no
//      open 24-hour window on the business number yet, and there may
//      never be one until the owner writes to it first.
//   2. So the message ASKS THEM TO ANSWER ON THE BUSINESS NUMBER, with
//      a one-tap link. That message opens the window, creates the
//      thread the whole team can see, and — because the link pre-fills
//      START UPDATES — records digest consent in the same tap. Without
//      it, the promise of updates in the closing block is not one the
//      Engine can keep.
//   3. THE FIRST ASK IS THE MINIMUM. No title deed, no khata, no
//      encumbrance certificate. Documents change hands after a buyer is
//      finalised and the token is paid; asking for them in the opening
//      message reads as distrust of someone who has not yet agreed to
//      anything. The papers checklist still exists — an agent turns it
//      on at the stage where it belongs.
//   4. The checklist follows the property's own type, so a plot owner
//      is never asked for a BHK configuration.
//
// An account can replace the prose wholesale (owner_details_request_
// settings.body_template, migration 262) while keeping the type-aware
// checklist through the {{checklist}} placeholder.
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

/**
 * The first ask, before anything is agreed: what the property is, what
 * they want for it, and what it looks like. `papers` and `possession`
 * are deliberately absent — see rule 3 in the header — and stay one tap
 * away for the agent who has reached the stage that needs them.
 */
export const OWNER_DETAILS_INTRO_SECTIONS: OwnerDetailsSection[] = [
  'identity',
  'construction',
  'price',
  'media',
];

/** The words the owner-digest webhook parses back off an inbound reply.
 *  Quoted in the message so the promise and the control are the same
 *  sentence — parseOwnerDigestCommand has to keep accepting both. */
export const DIGEST_PAUSE_COMMAND = 'STOP UPDATES';
export const DIGEST_RESUME_COMMAND = 'START UPDATES';

/** Says out loud that documents are not being asked for yet. Shown
 *  whenever the papers checklist is off, which is every first ask. */
export const PAPERS_LATER_NOTE =
  'No documents needed at this stage. Papers are shared later — once a buyer is finalised and the token is paid.';

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

/** Every section an agent may turn on for this property, in message
 *  order. A parcel has nothing built on it, so that one is not offered. */
export function availableOwnerDetailsSections(
  propertyType?: string | null
): OwnerDetailsSection[] {
  return OWNER_DETAILS_SECTIONS.filter(
    (s) => s !== 'construction' || !isLand(propertyType)
  );
}

/** What the first ask carries unless the agent says otherwise. */
export function defaultOwnerDetailsSections(
  propertyType?: string | null
): OwnerDetailsSection[] {
  return availableOwnerDetailsSections(propertyType).filter((s) =>
    OWNER_DETAILS_INTRO_SECTIONS.includes(s)
  );
}

/**
 * The link the OWNER taps, pointed at the business number rather than
 * at them. `START UPDATES` is pre-filled because parseOwnerDigestCommand
 * reads it on arrival: one tap opens the 24-hour window, creates the
 * thread the team shares, and records digest consent — which is what
 * makes the closing block's promise deliverable rather than a claim.
 *
 * `prefix` carries a sandbox tenant's #code; the webhook strips it
 * before anything downstream reads the text.
 */
export function ownerHandoverLink(engine: {
  phone: string;
  prefix?: string | null;
}): string {
  const digits = engine.phone.replace(/\D/g, '');
  const text = encodeURIComponent(
    `${engine.prefix ?? ''}${DIGEST_RESUME_COMMAND}`
  );
  return `https://wa.me/${digits}?text=${text}`;
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
  /** From ownerHandoverLink(). Absent — no number connected yet — drops
   *  the one-tap link and asks them to reply here instead. */
  engineLink?: string | null;
  /** The account's own wording, with {{placeholders}}. Null composes
   *  the built-in message below. */
  bodyTemplate?: string | null;
  /** Drives the salutation; omit for a plain "Hello". */
  now?: Date;
}

/** Placeholders an account's own `bodyTemplate` may use. Listed in the
 *  settings panel; anything else is left in the text untouched, so a
 *  typo is visible rather than silently blank. */
export const OWNER_DETAILS_PLACEHOLDERS = [
  'salutation',
  'owner_name',
  'property',
  'checklist',
  'engine_link',
  'agent_name',
  'agent_phone',
  'brand_name',
] as const;

export type OwnerDetailsPlaceholder =
  (typeof OWNER_DETAILS_PLACEHOLDERS)[number];

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

/**
 * The ask that moves the conversation onto the business number, and the
 * reason the owner should want it to move. Without a connected number
 * there is no link to give, so it degrades to "reply here" rather than
 * promising a channel the account does not have.
 */
function handover(input: OwnerDetailsRequestInput): string {
  const link = input.engineLink?.trim();
  if (!link) {
    return 'You can send all of it right here — photos, voice notes, whatever is easiest.';
  }
  return [
    'Please send these across on our office WhatsApp, so the whole team can act on it instead of it sitting on one phone:',
    link,
    'One tap opens the chat — photos, voice notes, whatever is easiest.',
  ].join('\n');
}

function updatesBlock(engineLink?: string | null): string {
  return [
    '*What you get back from that number*',
    engineLink
      ? 'From the moment your property is live, it keeps you posted. You will not have to call and ask:'
      : 'From the moment your property is live, our business number keeps you posted. You will not have to call and ask:',
    '• Every buyer who enquires about it',
    '• Buyers we shortlist and take it to',
    '• Site visits — scheduled, and how each one went',
    '• Offers, and anything discussed on your behalf',
  ].join('\n');
}

/** The numbered checklist on its own, so an account's own wording can
 *  drop it in through {{checklist}} and keep the type-awareness. */
export function ownerDetailsChecklist(
  sections: OwnerDetailsSection[],
  propertyType?: string | null
): string {
  return sections
    .map((section, i) => {
      const items = ownerDetailsSectionItems(section, propertyType)
        .map((item) => `• ${item}`)
        .join('\n');
      return `*${i + 1}. ${OWNER_DETAILS_SECTION_TITLES[section]}*\n${items}`;
    })
    .join('\n\n');
}

/** Substitutes {{placeholder}} in an account's own wording. Unknown
 *  names are left alone on purpose — see OWNER_DETAILS_PLACEHOLDERS. */
export function renderOwnerDetailsTemplate(
  template: string,
  values: Partial<Record<OwnerDetailsPlaceholder, string>>
): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? (values[name as OwnerDetailsPlaceholder] ?? '')
      : whole
  );
}

export function buildOwnerDetailsRequestMessage(
  input: OwnerDetailsRequestInput
): string {
  // Narrowed to what this property can actually be asked, not merely to
  // what is a valid section name. A caller holding an account-level
  // selection ("always ask what is built on it") would otherwise ask a
  // plot owner for its bedrooms — which is exactly the promise this
  // module makes and the settings preview was breaking.
  const offered = availableOwnerDetailsSections(input.propertyType);
  const sections = (
    input.sections?.length
      ? input.sections
      : defaultOwnerDetailsSections(input.propertyType)
  ).filter((s) => offered.includes(s));

  const checklist = ownerDetailsChecklist(sections, input.propertyType);

  if (input.bodyTemplate?.trim()) {
    return renderOwnerDetailsTemplate(input.bodyTemplate.trim(), {
      salutation: ownerSalutation(input.now),
      owner_name: respectfulName(input.ownerName),
      property: input.propertyLabel?.trim() || 'your property',
      checklist,
      engine_link: input.engineLink?.trim() ?? '',
      agent_name: input.agentName?.trim() ?? '',
      agent_phone: input.agentPhone?.trim() ?? '',
      brand_name: input.brandName?.trim() ?? '',
    }).trim();
  }

  // Asking a seller for their title deed before they have agreed to
  // anything is what the note replaces. It goes only when the papers
  // checklist is off, so the message never contradicts itself.
  const askingForPapers = sections.includes('papers');

  return [
    `${ownerSalutation(input.now)} ${respectfulName(input.ownerName)} 🙏`,
    opening(input),
    askingForPapers
      ? 'We are at the stage where I need the file itself. Send whatever you have ready now — the rest can follow.'
      : 'To get started I only need the basics. Send whatever you have ready now — the rest can follow.',
    checklist,
    askingForPapers ? '' : PAPERS_LATER_NOTE,
    handover(input),
    updatesBlock(input.engineLink),
    `_Reply ${DIGEST_PAUSE_COMMAND} on that number anytime to pause them, ${DIGEST_RESUME_COMMAND} to switch them back on._`,
    signOff(input),
  ]
    .filter(Boolean)
    .join('\n\n');
}
