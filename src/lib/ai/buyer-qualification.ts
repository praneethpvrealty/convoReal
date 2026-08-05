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
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import type { Contact } from '@/types';

export type QualifierField = 'type' | 'budget' | 'location';

/** Classifications the buyer ladder is allowed to run for. A Seller or
 *  Owner answering this number is not stating a buying requirement. */
const QUALIFIABLE_CLASSIFICATIONS = ['Buyer', 'Agent', 'Owner & Buyer'];

/** Bot replies allowed per conversation before it belongs to a human.
 *  Three covers the full ladder; anything past it is a conversation the
 *  ladder isn't solving. */
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

function hasLocation(prefs: ExtractedPreferences): boolean {
  return prefs.areas.length > 0 || prefs.projects.length > 0;
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
function typeLabel(prefs: ExtractedPreferences): string {
  const specific = prefs.property_types[0];
  if (specific) return specific.toLowerCase();
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

export function buildMatchesReply(
  contactName: string | null | undefined,
  matches: RankedPropertyMatch[],
  baseUrl: string,
  contactId: string
): string {
  const shown = matches.slice(0, MAX_MATCHES_SENT);
  const origin = baseUrl.replace(/\/+$/, '');

  const listings = shown.map((m, i) => {
    const [, title, specs, location] = buildPropertyAlertParams(
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

/** Localities of live inventory, most common first — chips for the
 *  location question so the buyer picks from what we can actually show. */
async function suggestAreas(accountId: string): Promise<string[]> {
  const { data } = await supabaseAdmin()
    .from('properties')
    .select('sublocality, city')
    .eq('account_id', accountId)
    .eq('is_published', true)
    .eq('status', 'Available')
    .limit(200);

  const counts = new Map<string, number>();
  for (const row of data || []) {
    const area = (row.sublocality || row.city || '').trim();
    if (area) counts.set(area, (counts.get(area) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_AREA_SUGGESTIONS)
    .map(([area]) => area);
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
      .select('*, contact_notes(note_text)')
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

    // Already answered as many times as the ladder needs — whatever is
    // being discussed now is a human's conversation.
    const { count: botTurns } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'bot');
    if ((botTurns ?? 0) >= MAX_BOT_TURNS) return false;

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
      const { error: updateErr } = await db
        .from('contacts')
        .update({
          requirements,
          pref_property_types: prefs.property_types,
          pref_property_categories: prefs.property_categories,
          pref_bhk_min: prefs.bhk_min,
          pref_bhk_max: prefs.bhk_max,
          pref_budget_min: prefs.budget_min,
          pref_budget_max: prefs.budget_max,
          pref_areas: prefs.areas,
          pref_excluded_areas: prefs.excluded_areas,
          pref_projects: prefs.projects,
          pref_suggested_tags: prefs.suggested_tags,
          pref_min_roi: prefs.min_roi,
          pref_listing_types: prefs.listing_types,
          pref_source_hash: hash,
          pref_extracted_at: new Date().toISOString(),
        })
        .eq('id', contact.id)
        .eq('account_id', accountId);
      if (updateErr) throw updateErr;
    }

    const missing = nextQualifier(prefs);
    if (missing) {
      const areas = missing === 'location' ? await suggestAreas(accountId) : [];
      await reply(
        buildQualifierQuestion(missing, prefs, areas),
        contactRecord,
        conversation,
        accessToken,
        phoneNumberId
      );
      return true;
    }

    const matches = await rankPropertiesForContact(db, accountId, contact.id);
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    await reply(
      matches.length
        ? buildMatchesReply(contact.name, matches, baseUrl, contact.id)
        : buildNoMatchReply(contact.name, prefs),
      contactRecord,
      conversation,
      accessToken,
      phoneNumberId
    );

    // Surface the same matches on Match Radar so the agent picks the
    // thread up already knowing what the lead was shown.
    void generateMatchEventForContact(db, accountId, contact.id).catch(
      (err) => {
        console.error('[buyer-qualification] radar event failed:', err);
      }
    );

    return true;
  } catch (err) {
    console.error(
      '[buyer-qualification] failed, leaving lead to an agent:',
      err
    );
    return false;
  }
}
