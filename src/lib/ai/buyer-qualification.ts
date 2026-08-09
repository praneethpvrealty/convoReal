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
import { saveBotMessage } from '@/lib/ai/chatbot-engine';
import {
  buildPreferenceSourceText,
  extractContactPreferences,
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
import { requestsHumanContact } from '@/lib/ai/lead-question';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { recordLearnedFacts } from '@/lib/learning/record';
import { visibleTagSuggestions } from '@/lib/contact-preferences';
import type { Contact } from '@/types';

export type QualifierField = 'type' | 'budget' | 'location';

/** Classifications the buyer ladder is allowed to run for. A Seller or
 *  Owner answering this number is not stating a buying requirement. */
const QUALIFIABLE_CLASSIFICATIONS = ['Buyer', 'Agent', 'Owner & Buyer'];

/** Bot REPLIES allowed per conversation before it belongs to a human.
 *  Three covers the full ladder; anything past it is a conversation the
 *  ladder isn't solving.
 *
 *  It caps talking, not listening. A lead who states their budget on
 *  the fourth turn has still stated their budget, and the cap used to
 *  sit ahead of the extraction — so everything said after an agent took
 *  the thread over was thrown away, and the contact's preferences froze
 *  at whatever the bot had managed to ask for. */
const MAX_BOT_TURNS = 3;

/** Listings per reply. Three is a shortlist; more reads as a dump. */
const MAX_MATCHES_SENT = 3;

/** Localities offered as chips on the location question. */
const MAX_AREA_SUGGESTIONS = 3;

const PROPERTY_TYPE_SIGNAL =
  /\b(land|plot|site|acres?|guntha|cents?|flat|apartment|villa|house|duplex|penthouse|studio|bhk|commercial|office|shop|retail|showroom|warehouse|godown|farm ?land|farmhouse|agricultur\w*|residential|independent|builder floor)\b/i;

const BUDGET_SIGNAL =
  /(\d+\s*(?:\.\d+)?\s*(?:cr|crore|crores|lakh|lakhs|lac|lacs|l|k)\b)|\bbudget\b|\b\d{6,}\b/i;

/**
 * True when an inbound message plausibly carries requirement detail —
 * a property type, a budget figure, or an explicit "looking for".
 * Deterministic on purpose: it gates the AI call, so it must be free.
 */
export function carriesRequirementSignal(text?: string | null): boolean {
  const clean = (text || '').trim();
  if (!clean) return false;
  return PROPERTY_TYPE_SIGNAL.test(clean) || BUDGET_SIGNAL.test(clean);
}

function hasType(prefs: ExtractedPreferences): boolean {
  return (
    prefs.property_types.length > 0 || prefs.property_categories.length > 0
  );
}

function hasBudget(prefs: ExtractedPreferences): boolean {
  return prefs.budget_min != null || prefs.budget_max != null;
}

function hasProject(prefs: ExtractedPreferences): boolean {
  return prefs.projects.length > 0;
}

function hasLocation(prefs: ExtractedPreferences): boolean {
  return prefs.areas.length > 0 || hasProject(prefs);
}

/**
 * The first rung of the ladder the contact has not answered, or null
 * when type, budget and location are all known.
 */
export function nextQualifier(
  prefs: ExtractedPreferences
): QualifierField | null {
  if (!hasType(prefs)) return 'type';
  if (!hasBudget(prefs)) return 'budget';
  if (!hasLocation(prefs)) return 'location';
  return null;
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

export function buildQualifierQuestion(
  field: QualifierField,
  prefs: ExtractedPreferences,
  areaSuggestions: string[] = []
): string {
  if (field === 'type') {
    return 'Got it 👍 What kind of property are you looking for — land/plot, apartment, villa, or commercial?';
  }

  if (field === 'budget') {
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
  if (field === 'budget') {
    return "One thing — what budget are you working with? I'll narrow these down.";
  }
  return "One thing — which area suits you best? I'll narrow these down.";
}

export function buildMatchesReply(
  contactName: string | null | undefined,
  matches: RankedPropertyMatch[],
  baseUrl: string,
  contactId: string,
  /** Appended when listings went out before the ladder was finished. */
  followUp?: string | null
): string {
  const shown = matches.slice(0, MAX_MATCHES_SENT);
  const origin = baseUrl.replace(/\/+$/, '');

  const listings = shown.map((m, i) => {
    // Skips the greeting AND the brokerage: this is a free-form list
    // inside a message the bot already signed, so repeating the name on
    // every line would read like a form letter.
    const [, , title, specs, location] = buildPropertyAlertParams(
      contactName,
      m.property
    );
    return [
      `*${i + 1}. ${title}*`,
      specs,
      `📍 ${location}`,
      `${origin}/?property_id=${m.property.id}&v=${contactId}`,
    ].join('\n');
  });

  const lead =
    shown.length === 1
      ? `Thanks ${firstName(contactName)} — here's one that fits 👇`
      : `Thanks ${firstName(contactName)} — here ${shown.length === 2 ? 'are 2' : `are ${shown.length}`} that fit 👇`;

  return [
    lead,
    '',
    listings.join('\n\n'),
    '',
    "Want photos or a site visit for any of these? Reply with the number and I'll set it up.",
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

export interface QualificationOutcome {
  /** The rung being asked, or null when the reply carries listings. */
  missing: QualifierField | null;
  /** Exactly the text the lead receives. */
  reply: string;
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
  contactId: string
): QualificationOutcome {
  const laddered = nextQualifier(prefs);
  const shortCircuit = shouldSendMatchesNow(prefs, matches.length);
  const missing = shortCircuit ? null : laddered;

  if (missing) {
    return { missing, reply: buildQualifierQuestion(missing, prefs, areaSuggestions) };
  }
  return {
    missing: null,
    reply: matches.length
      ? buildMatchesReply(
          contactName,
          matches,
          baseUrl,
          contactId,
          // Only when the listings jumped the queue: a ladder that
          // finished on its own has nothing left to ask.
          shortCircuit && laddered ? buildFollowUpQuestion(laddered) : null
        )
      : buildNoMatchReply(contactName, prefs),
  };
}

/**
 * Comparable form of the fields the ladder and the matcher read, so a
 * re-extraction that changed nothing can be told apart from one that
 * learned something new.
 */
export function preferenceSignature(prefs: ExtractedPreferences): string {
  const sorted = (vals: string[]) =>
    [...vals].map((v) => v.toLowerCase()).sort();
  return JSON.stringify([
    sorted(prefs.property_types),
    sorted(prefs.property_categories),
    prefs.bhk_min,
    prefs.bhk_max,
    prefs.budget_min,
    prefs.budget_max,
    sorted(prefs.areas),
    sorted(prefs.excluded_areas),
    sorted(prefs.projects),
    prefs.min_roi,
    sorted(prefs.listing_types),
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
    { field: 'pref_areas', value: prefs.areas },
    { field: 'pref_excluded_areas', value: prefs.excluded_areas },
    { field: 'pref_projects', value: prefs.projects },
    { field: 'pref_listing_types', value: prefs.listing_types },
    { field: 'pref_min_roi', value: prefs.min_roi },
    { field: 'pref_suggested_tags', value: prefs.suggested_tags },
  ];

  // Tags the buyer's own words earned but nobody has attached. Only
  // the unattached ones travel: proposing a tag the contact already
  // carries is a queue item that resolves to nothing.
  const unattached = visibleTagSuggestions(prefs.suggested_tags, attachedTagNames);
  if (unattached.length > 0) {
    facts.push({ field: 'tags', value: unattached });
  }

  return facts;
}

/** Preferences already on the contact row, in extraction shape. */
function prefsFromContact(contact: Contact): ExtractedPreferences {
  return {
    ...EMPTY_PREFERENCES,
    property_types: contact.pref_property_types || [],
    property_categories: (contact.pref_property_categories ||
      []) as ExtractedPreferences['property_categories'],
    bhk_min: contact.pref_bhk_min ?? null,
    bhk_max: contact.pref_bhk_max ?? null,
    budget_min: contact.pref_budget_min ?? null,
    budget_max: contact.pref_budget_max ?? null,
    areas: contact.pref_areas || [],
    excluded_areas: contact.pref_excluded_areas || [],
    projects: contact.pref_projects || [],
    min_roi: contact.pref_min_roi ?? null,
    listing_types: (contact.pref_listing_types ||
      []) as ExtractedPreferences['listing_types'],
    suggested_tags: contact.pref_suggested_tags || [],
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
  await saveBotMessage(conversation.id, text, sendRes.messageId);
}

/**
 * Handles an inbound lead message that states what they are looking
 * for. Returns true when the message was consumed and answered.
 */
export async function processBuyerQualificationMessage(
  contentText: string | null,
  contactRecord: { id: string; phone: string; name?: string | null },
  conversation: { id: string },
  accountId: string,
  accessToken: string,
  phoneNumberId: string
): Promise<boolean> {
  const text = contentText?.trim();
  if (!text) return false;

  // A lead asking to be called is not answering the ladder. Standing
  // down here rather than at the chatter guard below matters three
  // times over: "Call me" is not filed as their requirement, no
  // extraction is paid for, and the message falls through to the
  // handover branch that actually summons an agent.
  if (requestsHumanContact(text)) return false;

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

    // Read here, acted on after the extraction below. Past the cap the
    // conversation belongs to a human and the bot must not talk over
    // them — but it can still listen, and what a lead volunteers to an
    // agent is exactly the requirement detail the ladder was fishing
    // for.
    const { count: botTurns } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'bot');
    const atReplyCap = (botTurns ?? 0) >= MAX_BOT_TURNS;

    // A bare answer ("Devanahalli") carries no signal of its own — it
    // only means something because we asked the question directly
    // before it. Anything else needs to look like a requirement.
    const { data: recent } = await db
      .from('messages')
      .select('sender_type')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(2);
    const awaitingAnswer = (recent || [])[1]?.sender_type === 'bot';
    if (!awaitingAnswer && !carriesRequirementSignal(text)) return false;

    const requirements = appendRequirement(contact.requirements, text);
    const sourceText = buildPreferenceSourceText(
      requirements,
      contact.contact_notes
    );
    const hash = preferenceSourceHash(sourceText);

    let prefs = prefsFromContact(contact);
    if (hash !== contact.pref_source_hash) {
      await softBurn(accountId);
      const extracted = await extractContactPreferences(sourceText);

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
        (contact as unknown as {
          contact_tags?: { tags?: { name?: string | null } | null }[];
        }).contact_tags ?? []
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

    // Learned and filed. The cap bites here, on the reply: the thread
    // is a human's, so we stand down rather than answer — but Radar
    // fires, so the agent picks it up already seeing what the lead's
    // updated brief now matches.
    if (atReplyCap) {
      void generateMatchEventForContact(db, accountId, contact.id).catch(
        (err) => {
          console.error('[buyer-qualification] radar event failed:', err);
        }
      );
      return false;
    }

    // A named project earns a ranking run of its own, before any
    // question is asked — see shouldSendMatchesNow. Everything else
    // still waits for the ladder to finish, so an unqualified lead
    // never costs a scan of the account's inventory.
    const laddered = nextQualifier(prefs);
    const matches =
      !laddered || hasProject(prefs)
        ? await rankPropertiesForContact(db, accountId, contact.id, {
            strictArea: true,
          })
        : [];
    const missing = shouldSendMatchesNow(prefs, matches.length)
      ? null
      : laddered;
    const areas = missing === 'location' ? await suggestAreas(accountId) : [];
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const outcome = buildQualificationReply(
      prefs,
      contact.name,
      matches,
      areas,
      baseUrl,
      contact.id
    );

    await reply(
      outcome.reply,
      contactRecord,
      conversation,
      accessToken,
      phoneNumberId
    );

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
