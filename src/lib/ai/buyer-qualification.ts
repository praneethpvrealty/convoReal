/**
 * Lead qualification over WhatsApp.
 *
 * The lead-sync auto-reply asks every new portal lead for their
 * requirements and budget. This module is the listener behind that
 * question: it files the answer on the contact and replies, either
 * with the next missing qualifier or with matching inventory.
 *
 * The ladder is type → budget → location, and its state is derived
 * from the contact's own pref_* columns rather than a session row, so
 * an agent filling a field in the CRM moves the conversation on and a
 * half-finished thread never goes stale.
 *
 * Never throws: a qualification failure must leave the lead in the
 * Inbox for a human, not break the webhook.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/meta-api';
import {
  buildPreferenceSourceText,
  extractContactPreferences,
  listingTypesFromCurrentTurn,
  preferenceSourceHash,
  EMPTY_PREFERENCES,
  type ExtractedPreferences,
} from '@/lib/ai/preference-extraction';
import {
  generateMatchEventForContact,
  rankPropertiesForContact,
  type RankedPropertyMatch,
} from '@/lib/radar/engine';
import { buildPropertyAlertParams } from '@/lib/whatsapp/property-alert-template';
import { carriesRequirementSignal } from '@/lib/ai/requirement-signal';
import {
  applySizeAnchor,
  parseRelativeSizeSignal,
} from '@/lib/ai/size-feedback';
import { toSquareFeet } from '@/lib/ai/listing-derivations';
import { standsDownFromQualification } from '@/lib/ai/lead-routing';
import { propertyShowcaseUrl } from '@/lib/share-message-builder';
import { accountShowcaseOrigin } from '@/lib/showcase/account-showcase-url';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { recordLearnedFacts } from '@/lib/learning/record';
import { sendRequirementReview } from '@/lib/whatsapp/requirement-review';
import { logListingsSent } from '@/lib/whatsapp/share-property-send';
import { visibleTagSuggestions } from '@/lib/contact-preferences';
import { resolveRequirementSource } from '@/lib/requirements/profiles';
import { claimBuyerConsentAsk } from '@/lib/buyer/consent-ask';
import type { Contact, Property } from '@/types';

export type QualifierField = 'type' | 'intent' | 'budget' | 'location';

/** Classifications the buyer ladder is allowed to run for. A Seller or
 *  Owner answering this number is not stating a buying requirement. */
const QUALIFIABLE_CLASSIFICATIONS = ['Buyer', 'Agent', 'Owner & Buyer'];

/** Messages scanned for a human agent's presence. A staff reply among
 *  the last few messages means a person owns this thread, and the bot
 *  must not talk over them — it listens (extraction still runs) but
 *  leaves the answering to the human.
 *
 *  This replaced a count of bot messages: in a tap-driven thread
 *  (re-engagement templates, feedback lists, band lists) the bot has
 *  sent dozens of messages by design, and counting them silenced the
 *  reply exactly where a free-text requirement update deserved a
 *  re-ranked answer. */
const HUMAN_ACTIVITY_WINDOW = 6;

/** Listings per reply. Three is a shortlist; more reads as a dump. */
export const MAX_MATCHES_SENT = 3;

/** Localities offered as chips on the location question. */
const MAX_AREA_SUGGESTIONS = 3;

export { carriesRequirementSignal };

function hasType(prefs: ExtractedPreferences): boolean {
  return (
    prefs.property_types.length > 0 || prefs.property_categories.length > 0
  );
}

function hasBudget(prefs: ExtractedPreferences): boolean {
  return prefs.budget_min != null || prefs.budget_max != null;
}

function hasIntent(prefs: ExtractedPreferences): boolean {
  return prefs.listing_types.length > 0;
}

function hasProject(prefs: ExtractedPreferences): boolean {
  return prefs.projects.length > 0;
}

function hasLocation(prefs: ExtractedPreferences): boolean {
  return prefs.areas.length > 0 || hasProject(prefs);
}

// Intent before budget: the band list asks a rent-only lead for a
// monthly figure and everyone else for a sale figure, so asking budget
// first puts the wrong ladder in front of a tenant.
const QUALIFIER_ORDER: QualifierField[] = [
  'type',
  'intent',
  'budget',
  'location',
];

function isAnswered(
  field: QualifierField,
  prefs: ExtractedPreferences
): boolean {
  if (field === 'type') return hasType(prefs);
  if (field === 'intent') return hasIntent(prefs);
  if (field === 'budget') return hasBudget(prefs);
  return hasLocation(prefs);
}

/**
 * The first rung of the ladder the contact has not answered, or null
 * when type, intent, budget and location are all known.
 *
 * `asked` are the rungs this thread has already put to the lead. They
 * are skipped rather than repeated: a lead who answers "which area are
 * you looking at?" with "Anywhere. its fine, we buy and build" has
 * answered it — the extraction just has no locality to file, because
 * there isn't one. Asking again produced the same sentence word for
 * word, and would have kept producing it forever. Skipping the rung
 * moves the conversation to the next one, or to the listings, which is
 * what a person would do with the same reply.
 */
export function nextQualifier(
  prefs: ExtractedPreferences,
  asked: QualifierField[] = []
): QualifierField | null {
  for (const field of QUALIFIER_ORDER) {
    if (asked.includes(field)) continue;
    if (!isAnswered(field, prefs)) return field;
  }
  return null;
}

/**
 * The fragment of each rung's question that identifies it in a sent
 * message, so the thread itself records what has been asked and no
 * state has to be kept in step with it. Both phrasings of every rung —
 * the full question and the shortlist postscript — carry their own
 * fragment; a test asserts it, so the two cannot drift apart.
 */
const QUALIFIER_FINGERPRINTS: Record<QualifierField, RegExp> = {
  type: /what kind of property are you looking for|land\/plot, apartment, villa/i,
  intent: /looking to buy or to rent/i,
  budget: /what budget(?: range)? are you working with/i,
  location: /which area (?:are you looking at|suits you best)/i,
};

/**
 * True when this bot message is one of the ladder's own questions.
 *
 * The ladder used to claim any reply that followed any bot message,
 * which is only sound while the bot asks nothing else. It asks plenty:
 * a journey check-in ("when should we check back with you?"), a
 * feedback prompt, an alerts opt-in. A client answering the check-in
 * with "By the 5th of September" had that date filed as their BRIEF,
 * their preferences re-extracted from it, and a shortlist pitched
 * fourteen seconds after they had asked to be left until September.
 */
export function isQualifierQuestion(text?: string | null): boolean {
  return QUALIFIER_ORDER.some((field) =>
    QUALIFIER_FINGERPRINTS[field].test(text || '')
  );
}

/** Rungs already put to the lead, read back off the bot's own messages. */
export function askedQualifiers(
  botMessages: (string | null | undefined)[]
): QualifierField[] {
  return QUALIFIER_ORDER.filter((field) =>
    botMessages.some((text) => QUALIFIER_FINGERPRINTS[field].test(text || ''))
  );
}

/**
 * Show listings now instead of asking the next question.
 *
 * A buyer who names a project has given the matcher its most decisive
 * input — src/lib/matching.ts short-circuits its entire hierarchy on
 * one, letting it satisfy location and survive a type mismatch. The
 * ladder did not know that: it ranked projects third, so "if you have
 * any in Swiss town, Hollywood town or oval reef" was answered with
 * "what kind of property are you looking for?" while a matching plot
 * sat in inventory, and the turn budget ran out before it was ever
 * offered.
 *
 * Gated on actually having something to send. With no match the ladder
 * still runs — asking the next question beats "nothing fits, we'll
 * call you", which is where an ungated short-circuit would land every
 * buyer who named a project we have no stock in.
 */
export function shouldSendMatchesNow(
  prefs: ExtractedPreferences,
  matchCount: number
): boolean {
  return matchCount > 0 && hasProject(prefs);
}

function firstName(name?: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'there';
}

function formatBudget(prefs: ExtractedPreferences): string {
  const asWords = (n: number): string =>
    n >= 10000000
      ? `₹${(n / 10000000).toFixed(2).replace(/\.?0+$/, '')} Cr`
      : n >= 100000
        ? `₹${(n / 100000).toFixed(2).replace(/\.?0+$/, '')} L`
        : `₹${n.toLocaleString('en-IN')}`;
  const { budget_min: min, budget_max: max } = prefs;
  if (min != null && max != null) return `${asWords(min)}–${asWords(max)}`;
  if (max != null) return `up to ${asWords(max)}`;
  if (min != null) return `above ${asWords(min)}`;
  return '';
}

function formatDirectBudget(prefs: ExtractedPreferences): string {
  const asWords = (n: number): string =>
    n >= 10000000
      ? `₹${(n / 10000000).toFixed(2).replace(/\.?0+$/, '')} Cr`
      : n >= 100000
        ? `₹${(n / 100000).toFixed(2).replace(/\.?0+$/, '')} L`
        : `₹${n.toLocaleString('en-IN')}`;
  const { budget_min: min, budget_max: max } = prefs;
  if (min != null && max != null) return `${asWords(min)}–${asWords(max)}`;
  if (max != null) return `${asWords(max)}`;
  if (min != null) return `${asWords(min)}+`;
  return 'stated';
}

export interface EnquiryBudgetDisparityOpts {
  contactName: string | null | undefined;
  prefs: ExtractedPreferences;
  enquiredProperty: Property;
  leadPortal?: string | null;
  /** True when the thread's recent bot messages already referenced the listing */
  hasPriorListingDetails?: boolean;
}

export function buildEnquiryBudgetDisparityReply(
  opts: EnquiryBudgetDisparityOpts
): string {
  const name = firstName(opts.contactName);
  const prop = opts.enquiredProperty;
  let portal = 'Housing.com';
  if (opts.leadPortal) {
    const lp = opts.leadPortal.toLowerCase();
    if (lp.includes('housing')) portal = 'Housing.com';
    else if (lp.includes('magicbricks')) portal = 'MagicBricks';
    else if (lp.includes('99acres')) portal = '99acres';
    else portal = opts.leadPortal;
  }

  const propLoc =
    (prop.location || prop.sublocality || '').trim() || 'the area';
  const rawLand = prop.land_area ? Number(prop.land_area) : null;
  const landUnit = (prop.land_area_unit || 'sqft').toLowerCase().includes('sq')
    ? 'sq.ft'
    : prop.land_area_unit || 'sq.ft';
  const propArea =
    rawLand && rawLand > 0
      ? `${rawLand.toLocaleString('en-IN')} ${landUnit}`
      : prop.area_sqft && Number(prop.area_sqft) > 0
        ? `${Number(prop.area_sqft).toLocaleString('en-IN')} sq.ft`
        : '';

  const propPriceNum = Number(prop.price || 0);
  const priceBracket =
    propPriceNum >= 10_000_000
      ? `₹${Math.floor(propPriceNum / 10_000_000)}+ Cr`
      : propPriceNum >= 100_000
        ? `₹${Math.floor(propPriceNum / 100_000)}+ L`
        : '';

  const budgetFormatted = formatDirectBudget(opts.prefs);

  const propLocLower = propLoc.toLowerCase();
  const otherAreas = (opts.prefs.areas || []).filter(
    (a) =>
      !propLocLower.includes(a.toLowerCase()) &&
      !a.toLowerCase().includes(propLocLower)
  );

  const intro = opts.hasPriorListingDetails
    ? `Hi ${name}, the details above are for the specific ${propLoc} property you inquired about on ${portal}.`
    : `Hi ${name}, your initial inquiry was for the specific ${propLoc} property on ${portal}.`;

  const specSummary = [
    propArea ? `${propArea} plot` : 'property',
    `in ${propLoc}`,
    priceBracket ? `is in the ${priceBracket} bracket` : '',
  ]
    .filter(Boolean)
    .join(' ');

  let middle = '';
  let closing = '';

  if (otherAreas.length > 0) {
    const areaList =
      otherAreas.length === 1
        ? otherAreas[0]
        : otherAreas.length === 2
          ? `${otherAreas[0]} and ${otherAreas[1]}`
          : `${otherAreas.slice(0, -1).join(', ')}, and ${otherAreas[otherAreas.length - 1]}`;
    middle = `As a ${specSummary}, for your ${budgetFormatted} budget, we MAY have great residential options (2/3 BHK apartments and independent floors) in ${areaList}.`;
    closing = `Are you looking for an independent house/plot or an apartment in those areas? Let me know and I'll share the options within ${budgetFormatted}.`;
  } else {
    middle = `As a ${specSummary}, for your ${budgetFormatted} budget in ${propLoc}, options are typically 2/3 BHK apartments rather than large independent plots.`;
    closing = `Are you looking for an independent house/plot or an apartment? Let me know and I'll share the options within ${budgetFormatted}.`;
  }

  return [intro, '', middle, '', closing].join('\n');
}

/** Human label for what the contact said they want. */
/**
 * Human label for what the contact said they want.
 *
 * Taxonomy values are written for a dropdown, not for a sentence:
 * "Residential Land/ Plot" lowercased lands in a reply as "noted:
 * residential land/ plot", stray space and all. Tidy the separator so
 * the text reads like something a person typed.
 */
function typeLabel(prefs: ExtractedPreferences): string {
  const specific = prefs.property_types[0];
  if (specific) return specific.toLowerCase().replace(/\s*\/\s*/g, '/');
  const category = prefs.property_categories[0];
  return category ? `${category} property` : 'property';
}

function qualifiedMatchesOpening(
  contactName: string | null | undefined,
  prefs: ExtractedPreferences,
  count: number
): string {
  const deal =
    prefs.listing_types.length === 1
      ? prefs.listing_types[0] === 'Sale'
        ? ' for sale'
        : prefs.listing_types[0] === 'Rent'
          ? ' for rent'
          : ''
      : '';
  return count === 1
    ? `Thanks ${firstName(contactName)} — here's one matching ${typeLabel(prefs)}${deal} 👇`
    : `Thanks ${firstName(contactName)} — here are ${count} matching ${typeLabel(prefs)} options${deal} 👇`;
}

export function buildQualifierQuestion(
  field: QualifierField,
  prefs: ExtractedPreferences,
  areaSuggestions: string[] = []
): string {
  if (field === 'type') {
    return 'Got it 👍 What kind of property are you looking for — land/plot, apartment, villa, or commercial?';
  }

  if (field === 'intent') {
    return `Got it — ${typeLabel(prefs)}. Are you looking to buy or to rent?`;
  }

  if (field === 'budget') {
    if (
      prefs.listing_types.includes('Sale') &&
      !prefs.listing_types.includes('Rent')
    ) {
      return `Certainly — I've understood you're looking for ${typeLabel(prefs)} for purchase, not rent. What budget range are you working with?`;
    }
    if (
      prefs.listing_types.includes('Rent') &&
      !prefs.listing_types.includes('Sale')
    ) {
      return `Noted — you're looking for ${typeLabel(prefs)} to rent. What monthly rent budget are you working with?`;
    }
    return `Noted — ${typeLabel(prefs)}. What budget range are you working with?`;
  }

  const known = [typeLabel(prefs), formatBudget(prefs)]
    .filter(Boolean)
    .join(', ');
  const areas = areaSuggestions.slice(0, MAX_AREA_SUGGESTIONS);
  const hint = areas.length
    ? ` We have options in ${areas.join(', ')} — or tell me the area you prefer.`
    : '';
  return `Perfect — ${known}. Which area are you looking at?${hint}`;
}

/**
 * The same rung, asked as a postscript to a shortlist rather than as
 * the whole turn. Short-circuiting to matches skips questions but must
 * not abandon them — we still want the budget. The full versions open
 * with a greeting ("Got it 👍", "Noted —"), which trailing three
 * listings reads as though the bot forgot it had just spoken.
 */
export function buildFollowUpQuestion(field: QualifierField): string {
  if (field === 'type') {
    return "One thing — land/plot, apartment, villa or commercial? I'll narrow these down.";
  }
  if (field === 'intent') {
    return "One thing — are you looking to buy or to rent? I'll only send that half.";
  }
  if (field === 'budget') {
    return "One thing — what budget are you working with? I'll narrow these down.";
  }
  return "One thing — which area suits you best? I'll narrow these down.";
}

/**
 * The numbered listing blocks alone, capped to the shortlist size.
 * Shared with the preference-tap reply so a lead who taps the button
 * and a lead who types their requirement see inventory formatted the
 * same way.
 */
export function buildListingLines(
  contactName: string | null | undefined,
  matches: RankedPropertyMatch[],
  /** The account's showcase ORIGIN — accountShowcaseOrigin(), not the
   *  raw site URL and not the base, which carries `?ref=<uuid>` for an
   *  account with no subdomain. The listing link is the only thing in
   *  this message a lead can act on: the brokerage's own domain and
   *  its property code are what make it read as theirs rather than as
   *  a tracker. */
  baseUrl: string,
  contactId: string
): string[] {
  // accountShowcaseOrigin() returns a bare origin, so the path has to
  // be closed here or the link goes out as `https://host?property_id=`.
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const shown = matches.slice(0, MAX_MATCHES_SENT);
  // "1." in front of the only listing there is announces a list that
  // never arrives; the closing line asks about "these" for the same
  // reason. One listing is a listing.
  const numbered = shown.length > 1;
  return shown.map((m, i) => {
    // Skips the greeting AND the brokerage: this is a free-form list
    // inside a message the bot already signed, so repeating the name on
    // every line would read like a form letter.
    const [, , title, specs, location] = buildPropertyAlertParams(
      contactName,
      m.property
    );
    return [
      numbered ? `*${i + 1}. ${title}*` : `*${title}*`,
      specs,
      `📍 ${location}`,
      `${propertyShowcaseUrl(base, m.property)}&v=${encodeURIComponent(contactId)}`,
    ].join('\n');
  });
}

export function buildMatchesReply(
  contactName: string | null | undefined,
  matches: RankedPropertyMatch[],
  baseUrl: string,
  contactId: string,
  /** Appended when listings went out before the ladder was finished. */
  followUp?: string | null,
  opening?: string | null
): string {
  const shown = matches.slice(0, MAX_MATCHES_SENT);
  const listings = buildListingLines(contactName, matches, baseUrl, contactId);

  const lead =
    opening ??
    (shown.length === 1
      ? `Thanks ${firstName(contactName)} — here's one that fits 👇`
      : `Thanks ${firstName(contactName)} — here ${shown.length === 2 ? 'are 2' : `are ${shown.length}`} that fit 👇`);

  return [
    lead,
    '',
    listings.join('\n\n'),
    '',
    shown.length === 1
      ? "Want photos or a site visit? Just say the word and I'll set it up."
      : "Want photos or a site visit for any of these? Reply with the number and I'll set it up.",
    ...(followUp ? ['', followUp] : []),
  ].join('\n');
}

export function buildNoMatchReply(
  contactName: string | null | undefined,
  prefs: ExtractedPreferences
): string {
  const summary = [typeLabel(prefs), formatBudget(prefs), prefs.areas[0]]
    .filter(Boolean)
    .join(', ');
  return (
    `Thanks ${firstName(contactName)} — noted: ${summary}. ` +
    'Nothing in our live inventory matches that exactly right now, but we get new listings in every week. ' +
    'One of our team will call you shortly with the closest options.'
  );
}

/**
 * True when every listing this reply would show already went out in the
 * thread's recent bot messages. A lead who answers a shortlist with
 * feedback the matcher has no facet for ("looking for lesser
 * dimensions") re-ranks to the identical set — and was re-sent the same
 * listing as "one that fits", four minutes after implicitly rejecting
 * it. Matched on the title because that is the one line of a listing
 * block that appears verbatim in every send.
 */
export function shortlistAlreadySent(
  matches: RankedPropertyMatch[],
  recentBotTexts: (string | null)[]
): boolean {
  const shown = matches.slice(0, MAX_MATCHES_SENT);
  if (shown.length === 0) return false;
  return shown.every((m) => {
    const title = (m.property.title || '').trim();
    if (!title) return false;
    return recentBotTexts.some((t) => !!t && t.includes(title));
  });
}

/** The reply when the brief moved but the shortlist did not: file the
 *  update and keep the conversation going without repeating listings
 *  the lead is already looking at. */
export function buildShortlistStandsReply(
  contactName: string | null | undefined,
  laddered: QualifierField | null
): string {
  const noted = `Noted, ${firstName(contactName)} — I've updated your brief.`;
  if (laddered) return `${noted} ${buildFollowUpQuestion(laddered)}`;
  return `${noted} Those are still the closest live fits — the moment a new listing matches, you'll hear from us right here.`;
}

export interface QualificationOutcome {
  /** The rung being asked, or null when the reply carries listings. */
  missing: QualifierField | null;
  /** Exactly the text the lead receives. */
  reply: string;
  /** The listings this reply actually shows, for the share ledger —
   *  empty when it asks a question or acknowledges a shortlist that
   *  already went out. What was sent has to be recorded where it was
   *  decided, or the next send has no way to know. */
  sentPropertyIds: string[];
}

/**
 * The reply decision, given everything already gathered. The production
 * handler and the dev simulator both go through here, so what the
 * simulator prints is what a lead would actually be sent.
 */
export function buildQualificationReply(
  prefs: ExtractedPreferences,
  contactName: string | null | undefined,
  matches: RankedPropertyMatch[],
  areaSuggestions: string[],
  baseUrl: string,
  contactId: string,
  /** Rungs this thread has already put to the lead — see nextQualifier. */
  asked: QualifierField[] = [],
  /** The thread's recent bot messages, so a shortlist that already went
   *  out is acknowledged rather than re-sent verbatim. */
  recentBotTexts: (string | null)[] = [],
  enquiredContext?: {
    property: Property;
    leadPortal?: string | null;
  } | null
): QualificationOutcome {
  const laddered = nextQualifier(prefs, asked);
  const shortCircuit = shouldSendMatchesNow(prefs, matches.length);
  const missing = shortCircuit ? null : laddered;

  if (missing) {
    return {
      missing,
      reply: buildQualifierQuestion(missing, prefs, areaSuggestions),
      sentPropertyIds: [],
    };
  }
  if (matches.length && shortlistAlreadySent(matches, recentBotTexts)) {
    return {
      missing: null,
      reply: buildShortlistStandsReply(
        contactName,
        shortCircuit && laddered ? laddered : null
      ),
      sentPropertyIds: [],
    };
  }
  if (matches.length) {
    return {
      missing: null,
      reply: buildMatchesReply(
        contactName,
        matches,
        baseUrl,
        contactId,
        // Only when the listings jumped the queue: a ladder that
        // finished on its own has nothing left to ask.
        shortCircuit && laddered ? buildFollowUpQuestion(laddered) : null,
        qualifiedMatchesOpening(
          contactName,
          prefs,
          Math.min(matches.length, MAX_MATCHES_SENT)
        )
      ),
      sentPropertyIds: matches
        .slice(0, MAX_MATCHES_SENT)
        .map((m) => m.property.id),
    };
  }

  const isBudgetDisparity = Boolean(
    enquiredContext?.property &&
    enquiredContext.property.price &&
    prefs.budget_max &&
    Number(enquiredContext.property.price) >= Number(prefs.budget_max) * 1.25
  );

  if (isBudgetDisparity && enquiredContext?.property) {
    const propTitle = (enquiredContext.property.title || '').trim();
    const propCode = (enquiredContext.property.property_code || '').trim();
    const hasPriorListingDetails = recentBotTexts.some(
      (t) =>
        !!t &&
        ((propTitle && t.includes(propTitle.slice(0, 25))) ||
          (propCode && t.includes(propCode)) ||
          t.includes('👇') ||
          t.toLowerCase().includes('housing') ||
          t.toLowerCase().includes('listed'))
    );

    return {
      missing: null,
      reply: buildEnquiryBudgetDisparityReply({
        contactName,
        prefs,
        enquiredProperty: enquiredContext.property,
        leadPortal: enquiredContext.leadPortal,
        hasPriorListingDetails,
      }),
      sentPropertyIds: [],
    };
  }

  return {
    missing: null,
    reply: buildNoMatchReply(contactName, prefs),
    sentPropertyIds: [],
  };
}

/**
 * A list field as a comparable set of values.
 *
 * Gemini returns the same facts tokenised differently between runs. One
 * lead's stored areas were ["Block 4th Sir M Vishweshwaraiah Layout",
 * "Bangalore"]; re-extracting the unchanged brief returned the pair
 * joined into a single comma-separated string. Nothing had changed, but
 * an element-wise comparison read it as new information, so a lead who
 * had typed "Call me" was answered with the next qualifier.
 *
 * Splitting on the comma is a comparison decision and nothing else —
 * this value is never stored, and no enum member contains one.
 */
function comparableList(vals: string[]): string[] {
  const parts = (vals || []).flatMap((v) => String(v ?? '').split(','));
  const cleaned = parts
    .map((p) => p.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);
  return [...new Set(cleaned)].sort();
}

/**
 * Comparable form of the fields the ladder and the matcher read, so a
 * re-extraction that changed nothing can be told apart from one that
 * learned something new.
 */
export function preferenceSignature(prefs: ExtractedPreferences): string {
  return JSON.stringify([
    comparableList(prefs.property_types),
    comparableList(prefs.property_categories),
    prefs.bhk_min,
    prefs.bhk_max,
    prefs.budget_min,
    prefs.budget_max,
    prefs.land_area_min_sqft,
    prefs.land_area_max_sqft,
    comparableList(prefs.areas),
    comparableList(prefs.excluded_areas),
    comparableList(prefs.projects),
    prefs.min_roi,
    comparableList(prefs.listing_types),
  ]);
}

/**
 * The extraction, as candidates the learning framework can police.
 * Field names are the contact columns themselves — fields.ts owns
 * which of them are writable, and what happens when they change.
 */
export function preferenceFacts(
  prefs: ExtractedPreferences,
  /** Tag names already on the contact. A suggestion matching one is
   *  not a proposal, it is already done. */
  attachedTagNames: (string | null | undefined)[] = []
): { field: string; value: unknown }[] {
  const facts: { field: string; value: unknown }[] = [
    { field: 'pref_property_types', value: prefs.property_types },
    { field: 'pref_property_categories', value: prefs.property_categories },
    { field: 'pref_bhk_min', value: prefs.bhk_min },
    { field: 'pref_bhk_max', value: prefs.bhk_max },
    { field: 'pref_budget_min', value: prefs.budget_min },
    { field: 'pref_budget_max', value: prefs.budget_max },
    { field: 'pref_land_area_min_sqft', value: prefs.land_area_min_sqft },
    { field: 'pref_land_area_max_sqft', value: prefs.land_area_max_sqft },
    { field: 'pref_areas', value: prefs.areas },
    { field: 'pref_excluded_areas', value: prefs.excluded_areas },
    { field: 'pref_projects', value: prefs.projects },
    { field: 'pref_listing_types', value: prefs.listing_types },
    { field: 'pref_min_roi', value: prefs.min_roi },
    { field: 'pref_suggested_tags', value: prefs.suggested_tags },
  ];

  if (prefs.budget_min != null || prefs.budget_max != null) {
    facts.push({ field: 'no_budget', value: false });
  }

  // Tags the buyer's own words earned but nobody has attached. Only
  // the unattached ones travel: proposing a tag the contact already
  // carries is a queue item that resolves to nothing.
  const unattached = visibleTagSuggestions(
    prefs.suggested_tags,
    attachedTagNames
  );
  if (unattached.length > 0) {
    facts.push({ field: 'tags', value: unattached });
  }

  return facts;
}

/** Preferences already on the contact row, in extraction shape. */
/**
 * The ladder over a saved contact rather than an extraction. Two
 * things the raw prefs mapping cannot see: "no fixed budget"
 * (contacts.no_budget) is an answered budget rung, not a missing one,
 * and agent-entered areas_of_interest satisfy location just as well
 * as extracted pref_areas.
 */
export function nextQualifierForContact(
  contact: Contact
): QualifierField | null {
  const source = resolveRequirementSource(contact);
  const prefs = prefsFromContact(source);
  if (prefs.areas.length === 0 && (source.areas_of_interest?.length ?? 0) > 0) {
    prefs.areas = source.areas_of_interest as string[];
  }
  const missing = nextQualifier(prefs);
  if (missing !== 'budget' || !source.no_budget) return missing;
  return hasLocation(prefs) ? null : 'location';
}

export function prefsFromContact(contact: Contact): ExtractedPreferences {
  const source = resolveRequirementSource(contact);
  return {
    ...EMPTY_PREFERENCES,
    property_types: source.property_interests?.length
      ? source.property_interests
      : source.pref_property_types || [],
    property_categories: (source.pref_property_categories ||
      []) as ExtractedPreferences['property_categories'],
    bhk_min: source.pref_bhk_min ?? null,
    bhk_max: source.pref_bhk_max ?? null,
    budget_min: source.pref_budget_min ?? source.min_budget ?? null,
    budget_max: source.pref_budget_max ?? source.max_budget ?? null,
    land_area_min_sqft: source.pref_land_area_min_sqft ?? null,
    land_area_max_sqft: source.pref_land_area_max_sqft ?? null,
    areas: source.areas_of_interest?.length
      ? source.areas_of_interest
      : source.pref_areas || [],
    excluded_areas: source.pref_excluded_areas || [],
    projects: source.projects_of_interest?.length
      ? source.projects_of_interest
      : source.pref_projects || [],
    min_roi: source.min_roi ?? source.pref_min_roi ?? null,
    listing_types: (source.pref_listing_types ||
      []) as ExtractedPreferences['listing_types'],
    suggested_tags: source.pref_suggested_tags || [],
  };
}

export function mergeKnownPreferences(
  extracted: ExtractedPreferences,
  known: ExtractedPreferences
): ExtractedPreferences {
  const arrayOrKnown = <T>(values: T[], fallback: T[]): T[] =>
    values.length ? values : fallback;

  return {
    ...extracted,
    property_types: arrayOrKnown(
      extracted.property_types,
      known.property_types
    ),
    property_categories: arrayOrKnown(
      extracted.property_categories,
      known.property_categories
    ),
    bhk_min: extracted.bhk_min ?? known.bhk_min,
    bhk_max: extracted.bhk_max ?? known.bhk_max,
    budget_min: extracted.budget_min ?? known.budget_min,
    budget_max: extracted.budget_max ?? known.budget_max,
    land_area_min_sqft:
      extracted.land_area_min_sqft ?? known.land_area_min_sqft,
    land_area_max_sqft:
      extracted.land_area_max_sqft ?? known.land_area_max_sqft,
    areas: arrayOrKnown(extracted.areas, known.areas),
    excluded_areas: arrayOrKnown(
      extracted.excluded_areas,
      known.excluded_areas
    ),
    projects: arrayOrKnown(extracted.projects, known.projects),
    min_roi: extracted.min_roi ?? known.min_roi,
    listing_types: arrayOrKnown(extracted.listing_types, known.listing_types),
    suggested_tags: arrayOrKnown(
      extracted.suggested_tags,
      known.suggested_tags
    ),
  };
}

export function mergeCurrentTurnPreferences(
  extracted: ExtractedPreferences,
  known: ExtractedPreferences,
  currentText: string
): ExtractedPreferences {
  const merged = mergeKnownPreferences(extracted, known);
  const currentIntent = listingTypesFromCurrentTurn(currentText);
  return {
    ...merged,
    listing_types:
      currentIntent ??
      (known.listing_types.length > 0
        ? [...known.listing_types]
        : merged.listing_types),
  };
}

/**
 * Appends the new message to the contact's requirement brief unless it
 * is already there, so a repeated answer doesn't stack up.
 */
export function appendRequirement(
  existing: string | null | undefined,
  incoming: string
): string {
  const prev = (existing || '').trim();
  const next = incoming.trim();
  if (!next) return prev;
  if (prev.toLowerCase().includes(next.toLowerCase())) return prev;
  return prev ? `${prev}\n${next}` : next;
}

/**
 * Localities of live inventory, most common first — chips for the
 * location question so the buyer picks from what we can actually show.
 *
 * Exported for tests. Only sublocalities count: a listing with no
 * sublocality would otherwise contribute its city, and offering
 * "Koramangala, Bangalore, HSR Layout" to someone standing in Bangalore
 * is not a choice.
 */
export function tallyAreaSuggestions(
  rows: { sublocality?: string | null; city?: string | null }[]
): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const area = (row.sublocality || '').trim();
    if (!area) continue;
    if (area.toLowerCase() === (row.city || '').trim().toLowerCase()) continue;
    counts.set(area, (counts.get(area) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_AREA_SUGGESTIONS)
    .map(([area]) => area);
}

async function suggestAreas(accountId: string): Promise<string[]> {
  const { data } = await supabaseAdmin()
    .from('properties')
    .select('sublocality, city')
    .eq('account_id', accountId)
    .eq('is_published', true)
    .eq('status', 'Available')
    .limit(200);

  return tallyAreaSuggestions(data || []);
}

async function softBurn(accountId: string): Promise<void> {
  try {
    await burnCredits(
      accountId,
      'chatbot_auto_reply',
      AI_FEATURE_COSTS.chatbot_auto_reply,
      {
        hardBlock: false,
      }
    );
  } catch (err) {
    console.error('[buyer-qualification] credit burn failed (non-fatal):', err);
  }
}

async function reply(
  text: string,
  contactRecord: { phone: string },
  conversation: { id: string },
  accessToken: string,
  phoneNumberId: string
): Promise<void> {
  const sendRes = await sendTextMessage({
    phoneNumberId,
    accessToken,
    to: contactRecord.phone,
    text,
  });
  // Dynamic import: chatbot-engine also pulls in sharp (image upload),
  // which callers outside the WhatsApp webhook path (e.g. the outreach
  // follow-up cron) have no use for and no guarantee of a working
  // native binary for. Keep it out of their static bundle.
  const { saveBotMessage } = await import('@/lib/ai/chatbot-engine');
  await saveBotMessage(conversation.id, text, sendRes.messageId);
}

/**
 * True when the lead has already sent something after the message we
 * are processing.
 *
 * A lead thinking out loud sends a line at a time — "Land", then
 * "Commercial or Semi commercial" three seconds later. Each arrives as
 * its own webhook, so each was answered: the first with "Noted —
 * residential land/plot" (a guess off one word, and the wrong one) and
 * the second with "Noted — commercial land", both asking for the
 * budget. The lead had to read two questions to find one.
 *
 * The later message is the one that gets the reply, because by then the
 * brief holds both lines. The earlier one is still filed and still
 * learned from — only the answering is skipped.
 */
async function supersededByLaterMessage(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
  metaMessageId: string | null | undefined
): Promise<boolean> {
  if (!metaMessageId) return false;

  const { data: current } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('message_id', metaMessageId)
    .maybeSingle();
  if (!current?.created_at) return false;

  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .gt('created_at', current.created_at as string);

  return (count ?? 0) > 0;
}

/**
 * Handles an inbound lead message that states what they are looking
 * for. Returns true when the message was consumed and answered.
 */
/** The pinned listing's size in canonical square feet — land area
 *  first, built-up as the fallback — or null when neither is on file. */
async function lastShownListingAreaSqft(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  propertyId: string | null | undefined
): Promise<number | null> {
  if (!propertyId) return null;
  const { data } = await db
    .from('properties')
    .select('land_area, land_area_unit, area_sqft')
    .eq('id', propertyId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data) return null;
  const land = toSquareFeet(
    data.land_area as number | null,
    data.land_area_unit as string | null
  );
  if (land && land > 0) return land;
  const built = data.area_sqft != null ? Number(data.area_sqft) : null;
  return built && built > 0 ? built : null;
}

export async function processBuyerQualificationMessage(
  contentText: string | null,
  contactRecord: { id: string; phone: string; name?: string | null },
  conversation: { id: string },
  accountId: string,
  accessToken: string,
  phoneNumberId: string,
  /** Enables the requirement playback card on a fully-qualified
   *  no-match; without it the plain-text fallback goes out. */
  configOwnerUserId?: string,
  /** The inbound message's WhatsApp id, so a line the lead has already
   *  followed up on is filed without being separately answered. */
  metaMessageId?: string | null
): Promise<boolean> {
  const text = contentText?.trim();
  if (!text) return false;

  // A callback, a listing named by number, and a request for photos are
  // all messages the ladder used to claim and answer with the next
  // rung — a lead who asked to be phoned got "what budget range are you
  // working with?", and a lead who asked for images got "what kind of
  // property are you looking for?".
  //
  // Standing down here rather than at the chatter guard below matters
  // three times over for each of them: the message is not filed as
  // their requirement, no extraction is paid for, and it falls through
  // to the handler that can actually answer it.
  //
  // The decision itself lives in lead-routing so the dev simulator
  // reaches the same verdict — it does not call this function, and for
  // a while it went on showing agents the ladder question for messages
  // production had already stopped sending it for.
  if (standsDownFromQualification(text)) return false;

  try {
    const db = supabaseAdmin();

    const { data: config } = await db
      .from('whatsapp_config')
      .select('auto_qualify_leads')
      .eq('account_id', accountId)
      .maybeSingle();
    if (!config || config.auto_qualify_leads === false) return false;

    const { data: contactRow } = await db
      .from('contacts')
      .select('*, contact_notes(note_text), contact_tags(tags(name))')
      .eq('id', contactRecord.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!contactRow) return false;

    const contact = contactRow as Contact;
    if (contact.requirement_active === false) return false;
    if (
      !QUALIFIABLE_CLASSIFICATIONS.includes(contact.classification || 'Buyer')
    )
      return false;

    // One read serves two gates. A staff reply among the last few
    // messages means a person owns this thread; the bot still listens
    // — what a lead volunteers to an agent is exactly the requirement
    // detail the ladder was fishing for — but leaves the answering to
    // the human.
    const { data: recent } = await db
      .from('messages')
      .select('sender_type, content_text')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(HUMAN_ACTIVITY_WINDOW);
    const humanActive = (recent || []).some((m) => m.sender_type === 'agent');

    // The same window doubles as the record of what the ladder has
    // already asked — so a rung is never put twice — and of which
    // listings already went out, so a shortlist is never re-sent to a
    // lead who is answering it.
    const recentBotTexts = (recent || [])
      .filter((m) => m.sender_type === 'bot')
      .map((m) => m.content_text as string | null);
    const asked = askedQualifiers(recentBotTexts);

    // A bare answer ("Devanahalli") carries no signal of its own — it
    // only means something because THE LADDER asked its question
    // directly before it. Any other bot question standing there is
    // somebody else's, and its answer belongs to them: a date given to
    // a journey check-in is not a buying requirement. Anything else
    // needs to look like a requirement on its own.
    const previous = (recent || [])[1];
    const awaitingAnswer =
      previous?.sender_type === 'bot' &&
      isQualifierQuestion(previous.content_text as string | null);
    if (!awaitingAnswer && !carriesRequirementSignal(text)) return false;

    const requirements = appendRequirement(contact.requirements, text);
    const sourceText = buildPreferenceSourceText(
      requirements,
      contact.contact_notes
    );
    const hash = preferenceSourceHash(sourceText);

    // "Looking for lesser dimensions" states no figure the extraction
    // may file — it is relative to the listing the thread is pinned to.
    // Anchor the bound from that listing's own size, folded into the
    // extraction BEFORE the unchanged-signature early-out below, or the
    // message reads as chatter and earns silence.
    const sizeSignal = parseRelativeSizeSignal(text);
    const sizeAnchorSqft = sizeSignal
      ? await lastShownListingAreaSqft(
          db,
          accountId,
          contact.last_inquired_property_id
        )
      : null;

    let prefs = prefsFromContact(contact);
    if (hash !== contact.pref_source_hash) {
      await softBurn(accountId);
      const extracted = mergeCurrentTurnPreferences(
        applySizeAnchor(
          await extractContactPreferences(sourceText),
          sizeSignal,
          sizeAnchorSqft
        ),
        prefs,
        text
      );

      // The message added nothing the contact didn't already say — it's
      // chatter ("ok", "call me"), not an answer. Don't file it as a
      // requirement and don't answer it; the agent owns this thread.
      if (preferenceSignature(extracted) === preferenceSignature(prefs))
        return false;

      prefs = extracted;

      // The registry-governed fields go through the framework, which
      // applies them (they are 'auto' — the ladder reads them back on
      // the very next message) and leaves an audit row per field that
      // actually moved. Before this, Gemini rewrote a contact's budget,
      // areas and projects on every inbound message with no record at
      // all: one mis-parse of "not more than 2cr" changed who that
      // buyer matched, and there was nothing to look at and nothing to
      // roll back to.
      // Joined in by the select above; Contact does not model the join
      // row, and neither does any other reader of it.
      const attachedTagNames = (
        (
          contact as unknown as {
            contact_tags?: { tags?: { name?: string | null } | null }[];
          }
        ).contact_tags ?? []
      ).map((t) => t.tags?.name);

      await recordLearnedFacts({
        db,
        accountId,
        entity: 'contact',
        entityId: contact.id,
        current: {
          ...(contact as unknown as Record<string, unknown>),
          tags: attachedTagNames.filter(Boolean),
        },
        facts: preferenceFacts(prefs, attachedTagNames),
        evidence: text,
        source: 'lead_message',
        contactId: contact.id,
        conversationId: conversation.id,
      });

      // Bookkeeping only — every preference field now belongs to the
      // registry. The hash must be written even when nothing moved, or
      // the same text is re-extracted, and paid for, on every message.
      const { error: updateErr } = await db
        .from('contacts')
        .update({
          requirements,
          pref_source_hash: hash,
          pref_extracted_at: new Date().toISOString(),
        })
        .eq('id', contact.id)
        .eq('account_id', accountId);
      if (updateErr) throw updateErr;
    }

    // Learned and filed. The guard bites here, on the reply: the
    // thread is a human's, so we stand down rather than answer — but
    // Radar fires, so the agent picks it up already seeing what the
    // lead's updated brief now matches.
    if (humanActive) {
      void generateMatchEventForContact(db, accountId, contact.id).catch(
        (err) => {
          console.error('[buyer-qualification] radar event failed:', err);
        }
      );
      return false;
    }

    // Filed and learned from. The lead has since said more, so the
    // answer belongs to that message and not to this one.
    if (await supersededByLaterMessage(db, conversation.id, metaMessageId)) {
      return true;
    }

    // A named project earns a ranking run of its own, before any
    // question is asked — see shouldSendMatchesNow. Everything else
    // still waits for the ladder to finish, so an unqualified lead
    // never costs a scan of the account's inventory.
    const laddered = nextQualifier(prefs, asked);
    const matches =
      !laddered || hasProject(prefs)
        ? await rankPropertiesForContact(db, accountId, contact.id, {
            excludeAlreadySent: true,
            strictArea: true,
          })
        : [];
    const missing = shouldSendMatchesNow(prefs, matches.length)
      ? null
      : laddered;

    let enquiredProperty: Property | null = null;
    if (contact.last_inquired_property_id) {
      const { data } = await db
        .from('properties')
        .select('*')
        .eq('id', contact.last_inquired_property_id)
        .eq('account_id', accountId)
        .maybeSingle();
      enquiredProperty = data as Property | null;
    }

    const isBudgetDisparity = Boolean(
      enquiredProperty &&
      enquiredProperty.price &&
      prefs.budget_max &&
      Number(enquiredProperty.price) >= Number(prefs.budget_max) * 1.25
    );

    // Fully qualified, nothing fits: play the updated brief back with
    // one-tap corrections instead of "our team will call you", UNLESS
    // there is an enquiry-vs-budget disparity that warrants a direct
    // contextual bridge reply.
    if (
      !missing &&
      matches.length === 0 &&
      configOwnerUserId &&
      !isBudgetDisparity
    ) {
      const reviewed = await sendRequirementReview({
        db,
        accountId,
        userId: configOwnerUserId,
        contactId: contact.id,
        conversationId: conversation.id,
        contact: {
          ...contact,
          pref_property_types: prefs.property_types,
          pref_property_categories: prefs.property_categories,
          pref_bhk_min: prefs.bhk_min,
          pref_bhk_max: prefs.bhk_max,
          pref_budget_min: prefs.budget_min,
          pref_budget_max: prefs.budget_max,
          pref_land_area_min_sqft: prefs.land_area_min_sqft,
          pref_land_area_max_sqft: prefs.land_area_max_sqft,
          pref_areas: prefs.areas,
          pref_listing_types: prefs.listing_types,
        } as Contact,
      });
      if (reviewed) return true;
    }

    const areas = missing === 'location' ? await suggestAreas(accountId) : [];
    const baseUrl = await accountShowcaseOrigin(db, accountId);
    const outcome = buildQualificationReply(
      prefs,
      contact.name,
      matches,
      areas,
      baseUrl,
      contact.id,
      asked,
      recentBotTexts,
      enquiredProperty
        ? {
            property: enquiredProperty,
            leadPortal: contact.lead_portal || contact.source,
          }
        : null
    );

    await reply(
      outcome.reply,
      contactRecord,
      conversation,
      accessToken,
      phoneNumberId
    );

    if (outcome.sentPropertyIds.length > 0 && configOwnerUserId) {
      try {
        const consentAsk = await claimBuyerConsentAsk(
          db,
          accountId,
          contact,
          null,
          outcome.sentPropertyIds.length
        );
        if (consentAsk) {
          await reply(
            consentAsk,
            contactRecord,
            conversation,
            accessToken,
            phoneNumberId
          );
        }
      } catch (err) {
        console.error('[buyer-qualification] consent ask failed:', err);
      }
    }

    // What went out is recorded where it was decided, so a later
    // shortlist — days or weeks on, past any message window — knows
    // this lead has already seen these.
    if (configOwnerUserId) {
      await logListingsSent(
        db,
        accountId,
        configOwnerUserId,
        contact.id,
        outcome.sentPropertyIds
      );
    }

    // Surface the same matches on Match Radar so the agent picks the
    // thread up already knowing what the lead was shown. Only when
    // listings actually went out — a lead who was asked a question is
    // not a Radar event.
    if (!outcome.missing) {
      void generateMatchEventForContact(db, accountId, contact.id).catch(
        (err) => {
          console.error('[buyer-qualification] radar event failed:', err);
        }
      );
    }

    return true;
  } catch (err) {
    console.error(
      '[buyer-qualification] failed, leaving lead to an agent:',
      err
    );
    return false;
  }
}
