import {
  entityHref,
  propertyCodeFromMessage,
  type EntityReference,
} from './entities';
import { looksLikeNonSearchRequest } from './contact-search';
import type { CopilotNavigationLink } from './engine';

export const PROPERTY_INTEREST_LIMIT = 6;

export type InterestSignal =
  'any' | 'enquired' | 'viewed' | 'shortlisted' | 'visited' | 'liked';

export interface PropertyInterestQuery {
  direction: 'contacts' | 'properties';
  propertyIds: string[];
  ownerContactIds: string[];
  ownerName: string | null;
  propertyProbe: string | null;
  contactIds: string[];
  contactName: string | null;
  signal: InterestSignal;
  since: string | null;
  sinceLabel: string | null;
  /** No listing or contact named: every listing inside the time window. */
  across: boolean;
}

export interface InterestProperty {
  id: string;
  title: string | null;
  code: string | null;
  ownerName: string | null;
}

export interface InterestContact {
  id: string;
  label: string;
  classification: string | null;
}

export interface PropertyInterestMatch {
  propertyId: string;
  propertyTitle: string | null;
  propertyCode: string | null;
  contactId: string;
  label: string;
  classification: string | null;
  enquired: boolean;
  viewsCount: number;
  shortlisted: boolean;
  visited: boolean;
  liked: boolean;
  journeyStage: string | null;
  journeyStatus: string | null;
  lastAt: string | null;
}

export interface PropertyInterestResult {
  properties: InterestProperty[];
  contacts: InterestContact[];
  matches: PropertyInterestMatch[];
  total: number;
}

export type PropertyInterestExecutor = (
  query: PropertyInterestQuery
) => Promise<PropertyInterestResult>;

const PROPERTY_NOUN =
  '(?:propert(?:y|ies)|listings?|flats?|plots?|sites?|villas?|houses?|homes?|apartments?|offices?|shops?|units?|lands?|buildings?|projects?|farms?|farm\\s*houses?|pent\\s*houses?|bungalows?|showrooms?|warehouses?|godowns?)';
const ENGAGEMENT =
  /\b(?:show(?:ed|n|s|ing)?|express(?:ed|es|ing)?|ha(?:ve|s|d)|indicat(?:ed|es))\s+(?:an?\s+|any\s+|some\s+|their\s+)?interest\b|\binterested\b|\bkeen\s+on\b|\benquir(?:e|ed|ies|y|ing)\b|\binquir(?:e|ed|ies|y|ing)\b|\bview(?:ed|s)?\b|\bvisited\b|\bshortlisted\b|\bliked\b|\bengaged\b|\bresponded\b|\basked\s+(?:about|for)\b|\bsaw\b|\bseen\b|\bchecked\s+out\b|\bopened\b|\bclicked\b|\blooked\s+at\b|\bdekha\b|\bpoocha\b|\bpuchha\b/i;
const PAST_ENGAGEMENT =
  /\b(?:show(?:ed|n)|express(?:ed)|ha(?:ve|s|d)|indicat(?:ed))\s+(?:an?\s+|any\s+|some\s+|their\s+)?interest\b|\benquir(?:ed|ies|y)\b|\binquir(?:ed|ies|y)\b|\bviewed\b|\bvisited\b|\bshortlisted\b|\bliked\b|\bengaged\b|\bresponded\b|\basked\s+about\b|\bsaw\b|\bseen\b|\bchecked\s+out\b|\bopened\b|\bclicked\b|\blooked\s+at\b|\bdekha\b|\bpoocha\b|\bpuchha\b/i;
const NOT_A_NAME =
  /^(?:owner|owners|seller|sellers|landlord|client|clients|buyer|buyers|customer|customers|user|users|agent|agents|today|yesterday|tomorrow|week|month|year|this|that|these|those|my|our|your|their|his|her|its|someone|anyone|everyone|team|company|firm|builder|builders|tenant|tenants|lead|leads|contact|contacts|the|a|an|all|any|each|every|which|what|who|whose|it|list|one|in|on|at|about|for|of|to|with|from|by|and|or|interest|interested|enquired|enquire|enquiry|enquiries|inquired|inquire|inquiry|inquiries|viewed|view|views|visited|visit|shortlisted|liked|showed|shown|show|expressed|seen|saw|is|are|was|were|has|have|had|did|does|do|also|regarding|towards|kaun|kon|koi|ne|ki|ka|ke|jo|jisne|kisne|mein|me|hai|hain|ko|se|ya|aur)$/i;
const NAME_WORD = String.raw`[\p{L}][\p{L}\p{N}.'’-]*`;
const NAME = String.raw`(${NAME_WORD}(?:\s+${NAME_WORD}){0,2})`;
const OWNER_POSSESSIVE = new RegExp(
  String.raw`\b${NAME}(?:['’]s|\s+k[aei])\s+(?:(?:new|old|latest|recent|listed|commercial|residential|rental|rented|\d+\s*bhk)\s+)*${PROPERTY_NOUN}\b`,
  'iu'
);
const OWNER_CLAUSES: RegExp[] = [
  new RegExp(
    String.raw`\b${PROPERTY_NOUN}\s+(?:where|whose|for\s+which|of\s+which|in\s+which)\s+${NAME}\s+is\s+the\s+(?:owner|seller|landlord)\b`,
    'iu'
  ),
  new RegExp(
    String.raw`\b${PROPERTY_NOUN}\s+(?:owned|listed|posted|uploaded|put\s+up|sold|added)\s+by\s+${NAME}\b`,
    'iu'
  ),
  new RegExp(
    String.raw`\b${PROPERTY_NOUN}\s+(?:belonging\s+to|of\s+(?:the\s+)?owner|from\s+(?:the\s+)?owner)\s+${NAME}\b`,
    'iu'
  ),
  new RegExp(
    String.raw`\b(?:owner|seller|landlord)\s+(?:is\s+|named\s+|called\s+)?${NAME}(?=\s*$|[\s,.?!;])`,
    'iu'
  ),
  new RegExp(
    String.raw`\b${NAME}\s+is\s+the\s+(?:owner|seller|landlord)\b`,
    'iu'
  ),
];
const NAMED_TITLE = new RegExp(
  String.raw`\b${PROPERTY_NOUN}\s+(?:called|named|titled)\s+["“']?([^"”'?!.]+?)["”']?\s*(?:$|[?!.]|\s+(?:this|last|past|today|yesterday|in|since|during)\b)`,
  'iu'
);
const QUOTED_TITLE = /["“]([^"”]{3,80})["”]/u;
const DESCRIBED_PROPERTY = new RegExp(
  String.raw`\b(?:about|on|for|in|at|to|towards)\s+(?:the|this|that|our|my)\s+((?:(?!\b(?:${PROPERTY_NOUN.slice(3, -1)})\b)[^,.?!;'’]){2,60}?)\s+(${PROPERTY_NOUN})(?=\s*$|[\s,.?!;])`,
  'iu'
);
const GENERIC_NOUN = /^(?:propert(?:y|ies)|listings?|units?)$/i;
const UNNAMED_PROPERTY = new RegExp(
  String.raw`\b(?:my|our|this|that|his|her|their|the\s+(?:owner|seller|client|landlord)['’]s)\s+(?:own\s+)?${PROPERTY_NOUN}\b`,
  'iu'
);
const OWNER_QUESTION =
  /\b(?:who(?:['’]s|\s+is|\s+are)\s+the\s+(?:owner|seller|landlord)s?|owner\s+(?:details|contact|phone|number|name)|owner\s+of\s+(?:this|that|the|prop))\b/i;
const SUBJECT_WORDS =
  /\b(?:who|whom|which|what|list|show|find|get|give|any|how\s+many|contacts?|buyers?|leads?|clients?|customers?|people|tenants?|investors?|enquir(?:y|ies)|inquir(?:y|ies)|views?|visits?|kaun|kon|koi)\b/i;
const CONTACT_SUBJECT_FORMS: RegExp[] = [
  new RegExp(
    String.raw`\b(?:what|which)\s+(?:all\s+)?(?:${PROPERTY_NOUN.slice(3, -1)})\s+(?:did|has|have|was|were|is|does|do)\s+${NAME}\s+(?:enquire|inquire|view|visit|shortlist|like|see|ask|respond|engage|show|express|look|open|check|interested)`,
    'iu'
  ),
  new RegExp(
    String.raw`\b(?:${PROPERTY_NOUN.slice(3, -1)})\s+(?:that|which)\s+${NAME}\s+(?:has\s+|have\s+|had\s+|is\s+|was\s+)?(?:enquired|inquired|viewed|visited|shortlisted|liked|saw|seen|asked|responded|engaged|showed|shown|expressed|looked|opened|checked|interested)`,
    'iu'
  ),
  new RegExp(
    String.raw`\b${NAME}['’]s\s+(?:enquiries|inquiries|interests?|shortlist|views|viewed\s+(?:${PROPERTY_NOUN.slice(3, -1)}))\b`,
    'iu'
  ),
];
const SINCE_FORMS: Array<{
  pattern: RegExp;
  days: number | ((match: RegExpExecArray) => number);
  label: string | ((match: RegExpExecArray) => string);
}> = [
  { pattern: /\btoday\b|\baaj\b/i, days: 0, label: 'today' },
  { pattern: /\byesterday\b|\bkal\b/i, days: 1, label: 'since yesterday' },
  {
    pattern: /\b(?:this|the\s+past|past|last|previous)\s+week\b/i,
    days: 7,
    label: 'this week',
  },
  {
    pattern: /\b(?:this|the\s+past|past|last|previous)\s+month\b/i,
    days: 30,
    label: 'this month',
  },
  {
    pattern: /\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/i,
    days: (match) => Number(match[1]),
    label: (match) => `in the last ${match[1]} days`,
  },
  {
    pattern: /\b(?:last|past)\s+24\s+hours\b/i,
    days: 1,
    label: 'in the last 24 hours',
  },
  { pattern: /\brecently\b|\blately\b/i, days: 14, label: 'recently' },
];

function cleanName(raw: string): string | null {
  const words = raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  while (words.length && NOT_A_NAME.test(words[0])) words.shift();
  while (words.length && NOT_A_NAME.test(words[words.length - 1])) words.pop();
  if (
    !words.length ||
    words.some((w) => !/[\p{L}]/u.test(w) || /[\p{N}]/u.test(w))
  ) {
    return null;
  }
  return words.join(' ').slice(0, 60);
}

function readSignal(text: string): InterestSignal {
  if (/\bshortlist(?:ed)?\b/i.test(text)) return 'shortlisted';
  if (/\b(?:site\s+)?visit(?:ed|s)?\b/i.test(text)) return 'visited';
  if (/\bliked?\b|\bthumbs\s+up\b/i.test(text)) return 'liked';
  if (
    /\bview(?:ed|s)?\b|\bsaw\b|\bseen\b|\bopened\b|\bclicked\b|\blooked\s+at\b|\bdekha\b/i.test(
      text
    )
  )
    return 'viewed';
  if (/\benquir|\binquir|\basked\s+about\b|\bpoocha\b|\bpuchha\b/i.test(text))
    return 'enquired';
  return 'any';
}

function istStartOfDay(now: Date, daysBack: number): Date {
  const offsetMs = 330 * 60 * 1000;
  const shifted = new Date(now.getTime() + offsetMs);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCDate(shifted.getUTCDate() - daysBack);
  return new Date(shifted.getTime() - offsetMs);
}

export function readInterestWindow(
  text: string,
  now: Date = new Date()
): { since: string | null; sinceLabel: string | null } {
  for (const form of SINCE_FORMS) {
    const match = form.pattern.exec(text);
    if (!match) continue;
    const days = typeof form.days === 'function' ? form.days(match) : form.days;
    if (!Number.isFinite(days) || days < 0 || days > 365) continue;
    const label =
      typeof form.label === 'function' ? form.label(match) : form.label;
    return { since: istStartOfDay(now, days).toISOString(), sinceLabel: label };
  }
  return { since: null, sinceLabel: null };
}

function readOwnerName(text: string): string | null {
  const possessive = OWNER_POSSESSIVE.exec(text);
  if (possessive) {
    const name = cleanName(possessive[1]);
    if (name) return name;
  }
  for (const clause of OWNER_CLAUSES) {
    const match = clause.exec(text);
    if (!match) continue;
    const name = cleanName(match[1]);
    if (name) return name;
  }
  return null;
}

function readPropertyProbe(
  text: string,
  allowDescribed: boolean
): string | null {
  const named = NAMED_TITLE.exec(text);
  if (named) return named[1].trim().slice(0, 80) || null;
  const quoted = QUOTED_TITLE.exec(text);
  if (quoted) return quoted[1].trim().slice(0, 80) || null;
  if (!allowDescribed) return null;
  const described = DESCRIBED_PROPERTY.exec(text);
  if (!described) return null;
  const noun = described[2].trim();
  const probe = [described[1], GENERIC_NOUN.test(noun) ? '' : noun]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(probe) ? probe.slice(0, 80) : null;
}

function readContactSubject(text: string): string | null {
  for (const form of CONTACT_SUBJECT_FORMS) {
    const match = form.exec(text);
    if (!match) continue;
    const name = cleanName(match[1]);
    if (name) return name;
  }
  return null;
}

export function parsePropertyInterestQuestion(
  message: string,
  entities: EntityReference[] = [],
  now: Date = new Date()
): PropertyInterestQuery | null {
  const text = message.trim();
  if (!text || text.length > 500) return null;
  if (looksLikeNonSearchRequest(text)) return null;
  const engaged = ENGAGEMENT.test(text);
  if (OWNER_QUESTION.test(text)) return null;
  if (!engaged && !(SUBJECT_WORDS.test(text) && readOwnerName(text))) {
    return null;
  }

  const propertyEntities = entities.filter((e) => e.kind === 'property');
  const contactEntities = entities.filter((e) => e.kind === 'contact');
  const hasPropertyNoun = new RegExp(
    String.raw`\b${PROPERTY_NOUN}\b`,
    'i'
  ).test(text);
  const base = {
    signal: readSignal(text),
    ...readInterestWindow(text, now),
    across: false,
  };

  const contactSubject = readContactSubject(text);
  if (
    contactSubject ||
    (contactEntities.length === 1 &&
      propertyEntities.length === 0 &&
      hasPropertyNoun &&
      !OWNER_POSSESSIVE.test(text))
  ) {
    return {
      direction: 'properties',
      propertyIds: [],
      ownerContactIds: [],
      ownerName: null,
      propertyProbe: null,
      contactIds: contactEntities.map((e) => e.id),
      contactName: contactEntities.length ? null : contactSubject,
      ...base,
    };
  }

  if (propertyEntities.length) {
    return {
      direction: 'contacts',
      propertyIds: propertyEntities.map((e) => e.id),
      ownerContactIds: [],
      ownerName: null,
      propertyProbe: null,
      contactIds: [],
      contactName: null,
      ...base,
    };
  }
  const propertyCode = propertyCodeFromMessage(text);
  if (propertyCode) {
    return {
      direction: 'contacts',
      propertyIds: [],
      ownerContactIds: [],
      ownerName: null,
      propertyProbe: propertyCode,
      contactIds: [],
      contactName: null,
      ...base,
    };
  }

  if (contactEntities.length === 1 && hasPropertyNoun) {
    return {
      direction: 'contacts',
      propertyIds: [],
      ownerContactIds: [contactEntities[0].id],
      ownerName: null,
      propertyProbe: null,
      contactIds: [],
      contactName: null,
      ...base,
    };
  }

  const ownerName = readOwnerName(text);
  const propertyProbe = ownerName
    ? null
    : readPropertyProbe(text, PAST_ENGAGEMENT.test(text));
  const unresolved =
    !ownerName &&
    !propertyProbe &&
    engaged &&
    SUBJECT_WORDS.test(text) &&
    (base.since != null || UNNAMED_PROPERTY.test(text));
  if (!ownerName && !propertyProbe && !unresolved) return null;
  return {
    direction: 'contacts',
    propertyIds: [],
    ownerContactIds: [],
    ownerName,
    propertyProbe,
    contactIds: [],
    contactName: null,
    ...base,
    across: unresolved && base.since != null && !UNNAMED_PROPERTY.test(text),
  };
}

export function isPropertyInterestQuestion(
  message: string,
  entities: EntityReference[] = []
): boolean {
  return parsePropertyInterestQuestion(message, entities) !== null;
}

function formatDay(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

export function interestReasonLabel(match: PropertyInterestMatch): string {
  const parts: string[] = [];
  if (match.enquired) parts.push('Enquired');
  if (match.viewsCount > 0) {
    parts.push(match.viewsCount > 1 ? `${match.viewsCount} views` : 'Viewed');
  }
  if (match.shortlisted) parts.push('Shortlisted');
  if (match.visited) parts.push('Site visit');
  if (match.liked) parts.push('Liked');
  if (match.journeyStage) {
    parts.push(
      match.journeyStatus === 'dropped'
        ? `Dropped after ${match.journeyStage}`
        : `At ${match.journeyStage}`
    );
  }
  return parts.join(' · ');
}

export function propertyLabel(property: {
  title: string | null;
  code: string | null;
}): string {
  return property.title?.trim() || property.code || 'Untitled listing';
}

function propertyShortLabel(match: PropertyInterestMatch): string {
  return match.propertyCode || match.propertyTitle?.trim() || 'listing';
}

function signalVerb(signal: InterestSignal): string {
  switch (signal) {
    case 'enquired':
      return 'enquired about';
    case 'viewed':
      return 'viewed';
    case 'shortlisted':
      return 'were shortlisted for';
    case 'visited':
      return 'had a site visit for';
    case 'liked':
      return 'liked';
    default:
      return 'showed interest in';
  }
}

function perfectSignalVerb(signal: InterestSignal): string {
  switch (signal) {
    case 'any':
      return 'enquired about, viewed, shortlisted or visited';
    case 'shortlisted':
      return 'been shortlisted for';
    default:
      return signalVerb(signal);
  }
}

function singularSignalVerb(signal: InterestSignal): string {
  switch (signal) {
    case 'shortlisted':
      return 'was shortlisted for';
    case 'visited':
      return 'had a site visit for';
    default:
      return signalVerb(signal);
  }
}

function describeTarget(
  query: PropertyInterestQuery,
  properties: InterestProperty[]
): string {
  if (properties.length === 1) {
    const owner = properties[0].ownerName?.trim();
    return `${propertyLabel(properties[0])}${owner ? ` (${owner}'s listing)` : ''}`;
  }
  const owner = query.ownerName ?? properties[0]?.ownerName?.trim();
  return owner
    ? `${owner}'s ${properties.length} listings`
    : `these ${properties.length} listings`;
}

function describeSubject(query: PropertyInterestQuery): string {
  if (query.ownerName) return `a listing owned by ${query.ownerName}`;
  if (query.ownerContactIds.length) return 'a listing owned by that contact';
  if (query.propertyProbe) return `a listing matching "${query.propertyProbe}"`;
  return 'that listing';
}

function audienceLink(propertyId: string): CopilotNavigationLink {
  return {
    label: 'Listing audience',
    subtitle: 'Everyone who enquired or viewed',
    navigateTo: `/inventory?sharePropertyId=${encodeURIComponent(propertyId)}&shareAudience=1`,
  };
}

function contactsAnswer(
  query: PropertyInterestQuery,
  result: PropertyInterestResult
): { reply: string; links: CopilotNavigationLink[] } {
  const when = query.sinceLabel ? ` ${query.sinceLabel}` : '';
  const unnamed =
    !query.propertyIds.length &&
    !query.ownerContactIds.length &&
    !query.ownerName &&
    !query.propertyProbe;
  if (unnamed && !query.across) {
    return {
      reply:
        'Tell me which listing — pick it with # or give me its PROP code, or name its owner ("Adithi\'s property") — and I\'ll list who showed interest in it.',
      links: [{ label: 'Open Inventory', navigateTo: '/inventory' }],
    };
  }
  if (!result.properties.length && !query.across) {
    return {
      reply: `I couldn't find ${describeSubject(query)}. Pick the property with # or give me its PROP code and I'll list who showed interest.`,
      links: [{ label: 'Open Inventory', navigateTo: '/inventory' }],
    };
  }
  const many = query.across || result.properties.length > 1;
  const target = query.across
    ? 'your listings'
    : describeTarget(query, result.properties);
  const seenProperties = new Set<string>();
  const propertyLinks: CopilotNavigationLink[] = (
    query.across
      ? result.matches
          .filter((match) => {
            if (seenProperties.has(match.propertyId)) return false;
            seenProperties.add(match.propertyId);
            return true;
          })
          .map((match) => ({
            id: match.propertyId,
            title: match.propertyTitle,
            code: match.propertyCode,
          }))
      : result.properties
  )
    .slice(0, 3)
    .map((property) => ({
      label: `Open ${propertyLabel(property)}`,
      subtitle: property.code ?? undefined,
      navigateTo: entityHref('property', property.id),
    }));
  if (result.total === 0 || !result.matches.length) {
    return {
      reply: `No contact has ${perfectSignalVerb(query.signal)} ${target}${when} yet.${query.signal === 'any' ? '' : ' Ask without the filter to see every kind of interest.'}`,
      links: propertyLinks,
    };
  }
  const shown = result.matches.length;
  const headline =
    result.total === 1
      ? `1 contact ${singularSignalVerb(query.signal)} ${target}${when}:`
      : result.total > shown
        ? `${result.total} contacts ${signalVerb(query.signal)} ${target}${when}. Latest ${shown}:`
        : `${result.total} contacts ${signalVerb(query.signal)} ${target}${when}:`;
  const lines = result.matches.map((match) => {
    const bits = [
      match.classification,
      interestReasonLabel(match) || null,
      many ? propertyShortLabel(match) : null,
      formatDay(match.lastAt),
    ].filter((bit): bit is string => !!bit);
    return `• ${match.label}${bits.length ? ` — ${bits.join(' · ')}` : ''}`;
  });
  const seen = new Set<string>();
  const links: CopilotNavigationLink[] = [];
  for (const match of result.matches) {
    if (seen.has(match.contactId)) continue;
    seen.add(match.contactId);
    const subtitle = [
      match.classification,
      interestReasonLabel(match) || null,
      many ? propertyShortLabel(match) : null,
    ]
      .filter((bit): bit is string => !!bit)
      .join(' · ');
    links.push({
      label: match.label,
      ...(subtitle ? { subtitle } : {}),
      navigateTo: entityHref('contact', match.contactId),
    });
  }
  if (result.total > shown && result.properties.length === 1) {
    links.push(audienceLink(result.properties[0].id));
  }
  links.push(...propertyLinks);
  return {
    reply: `${headline}\n${lines.join('\n')}\n\nTap a name to open the contact.`,
    links,
  };
}

function propertiesAnswer(
  query: PropertyInterestQuery,
  result: PropertyInterestResult
): { reply: string; links: CopilotNavigationLink[] } {
  const when = query.sinceLabel ? ` ${query.sinceLabel}` : '';
  if (!result.contacts.length) {
    return {
      reply: `I couldn't find a contact${query.contactName ? ` named ${query.contactName}` : ''}. Pick them with @ and I'll list the listings they showed interest in.`,
      links: [{ label: 'Open Contacts', navigateTo: '/contacts' }],
    };
  }
  const who =
    result.contacts.length === 1
      ? result.contacts[0].label
      : `${result.contacts.length} contacts named ${query.contactName ?? 'that'}`;
  const contactLinks: CopilotNavigationLink[] = result.contacts
    .slice(0, 3)
    .map((contact) => ({
      label: `Open ${contact.label}`,
      subtitle: contact.classification ?? undefined,
      navigateTo: entityHref('contact', contact.id),
    }));
  if (result.total === 0 || !result.matches.length) {
    return {
      reply: `${who} has not ${perfectSignalVerb(query.signal)} any listing${when} yet.`,
      links: contactLinks,
    };
  }
  const shown = result.matches.length;
  const verb =
    query.signal === 'any'
      ? 'showed interest in'
      : singularSignalVerb(query.signal);
  const headline =
    result.total > shown
      ? `${who} ${verb} ${result.total} listings${when}. Latest ${shown}:`
      : `${who} ${verb} ${result.total === 1 ? '1 listing' : `${result.total} listings`}${when}:`;
  const lines = result.matches.map((match) => {
    const bits = [
      match.propertyCode,
      interestReasonLabel(match) || null,
      result.contacts.length > 1 ? match.label : null,
      formatDay(match.lastAt),
    ].filter((bit): bit is string => !!bit);
    return `• ${match.propertyTitle?.trim() || match.propertyCode || 'Untitled listing'}${bits.length ? ` — ${bits.join(' · ')}` : ''}`;
  });
  const seen = new Set<string>();
  const links: CopilotNavigationLink[] = [];
  for (const match of result.matches) {
    if (seen.has(match.propertyId)) continue;
    seen.add(match.propertyId);
    const subtitle = [match.propertyCode, interestReasonLabel(match) || null]
      .filter((bit): bit is string => !!bit)
      .join(' · ');
    links.push({
      label:
        match.propertyTitle?.trim() || match.propertyCode || 'Untitled listing',
      ...(subtitle ? { subtitle } : {}),
      navigateTo: entityHref('property', match.propertyId),
    });
  }
  links.push(...contactLinks);
  return {
    reply: `${headline}\n${lines.join('\n')}\n\nTap a listing to open it.`,
    links,
  };
}

export function buildPropertyInterestAnswer(
  query: PropertyInterestQuery,
  result: PropertyInterestResult
): { reply: string; links: CopilotNavigationLink[] } {
  return query.direction === 'properties'
    ? propertiesAnswer(query, result)
    : contactsAnswer(query, result);
}
