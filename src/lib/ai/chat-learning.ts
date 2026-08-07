// ============================================================
// Learning a listing's commercial facts from what an agent types.
//
// An agent answering "is this negotiable?" with "seller's final price
// is 10.5k per sqft" has just stated a fact the listing does not carry.
// Today it dies in the bubble: the next buyer asks the same question,
// the bot has nothing in `properties` to answer from, and the agent
// retypes the number. This module turns that sentence into a pending
// suggestion against the listing.
//
// Three gates, cheapest first — the same ladder answerLeadQuestion
// walks, for the same reason: this runs on EVERY outbound agent
// message, so the common case must cost nothing.
//   1. A regex for price language. Free, and rejects "ok", "sure",
//      "I'll call you at 4" without a round trip.
//   2. A subject listing (the newest property_shares row for this
//      contact). No listing, nothing to attach a fact to.
//   3. Gemini, told to return nothing rather than guess.
//
// It proposes; it never writes. See 216_property_fact_suggestions.sql
// for why a mis-parse must not be able to reprice live inventory.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateJson } from '@/lib/ai/gemini';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import {
  SUGGESTABLE_PROPERTY_FIELDS,
  type SuggestablePropertyField,
} from '@/types';

const AI_FEATURE = 'chatbot_classify' as const;

/**
 * Price language worth spending a model call on. Deliberately narrow:
 * a plain "the price is 4.41 Cr" is the agent repeating the listing,
 * not revising it, so a bare price word is not enough — the sentence
 * has to carry finality, a revision, or a rate.
 */
const PRICE_FACT_SIGNAL =
  /\b(final(is|iz)?(ed)?|final price|best price|bottom line|lowest|last price|net price|will (not |n[o']t )?go below|settle(d)? (at|for)|agreed (at|to)|accept(s|ed)? (at|for)|come down to|reduced to|revised to|negotiab\w*|per\s*sq\.?\s*ft|per\s*sqft|psf)\b/i;

/** A figure has to be present too — "the price is final" states no number. */
const AMOUNT_SIGNAL =
  /(\d+(?:\.\d+)?)\s*(cr|crore|crores|lakh|lakhs|lac|lacs|k|thousand)?\b/i;

/**
 * True when an outbound agent message plausibly states a price fact
 * about the listing. Free by construction — it gates the AI call.
 */
export function carriesPriceFactSignal(text?: string | null): boolean {
  const clean = (text || '').trim();
  if (!clean) return false;
  if (!PRICE_FACT_SIGNAL.test(clean)) return false;
  return AMOUNT_SIGNAL.test(clean) && /\d/.test(clean);
}

export interface ExtractedPriceFact {
  field: SuggestablePropertyField;
  value: number;
}

/**
 * Bounds a parsed figure to what a real Indian listing can be, per
 * field. A model that reads "10.5k per sqft" as 10.5 would otherwise
 * propose a rate of ten and a half rupees, and a reviewer skimming a
 * queue can approve a wrong number faster than they can spot it.
 */
const FIELD_BOUNDS: Record<
  SuggestablePropertyField,
  { min: number; max: number }
> = {
  // ₹1 lakh to ₹10,000 Cr.
  seller_final_price: { min: 100_000, max: 100_000_000_000 },
  // ₹100 to ₹5 lakh per Sq.Ft.
  seller_final_price_per_sqft: { min: 100, max: 500_000 },
};

/** Keeps only well-formed, in-range facts, one per field. */
export function sanitizePriceFacts(raw: unknown): ExtractedPriceFact[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: ExtractedPriceFact[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { field, value } = entry as { field?: unknown; value?: unknown };
    if (typeof field !== 'string') continue;
    if (!(SUGGESTABLE_PROPERTY_FIELDS as readonly string[]).includes(field))
      continue;
    if (seen.has(field)) continue;

    const typed = field as SuggestablePropertyField;
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) continue;

    const bounds = FIELD_BOUNDS[typed];
    if (num < bounds.min || num > bounds.max) continue;

    seen.add(field);
    out.push({ field: typed, value: Math.round(num) });
  }

  return out;
}

const SYSTEM_INSTRUCTION =
  'You read one message a real-estate agent sent to a buyer on WhatsApp about ONE specific listing, and extract any statement about what the SELLER will finally accept.\n' +
  'Return JSON: {"facts": [{"field": "...", "value": <number>}]}\n\n' +
  'Fields (use only these):\n' +
  '  "seller_final_price" — the lowest TOTAL price the seller will accept, in plain rupees.\n' +
  '  "seller_final_price_per_sqft" — the lowest PER SQUARE FOOT rate the seller will accept, in plain rupees.\n\n' +
  'Rules:\n' +
  '1. Indian number formats: Crore/Cr = 10000000, Lakh/L/Lac = 100000, k = 1000. "10.5k per sqft" -> 10500. "4.2 Cr" -> 42000000.\n' +
  '2. A rate ("per sqft", "psf", "per square foot") is ALWAYS seller_final_price_per_sqft, never the total — do not multiply by an area.\n' +
  "3. Extract ONLY a seller's final/best/accepted figure. The agent repeating the advertised asking price, quoting a buyer's offer, quoting rent, or describing a nearby deal is NOT a fact — return an empty array.\n" +
  '4. If the agent says the price is negotiable but names no figure, return an empty array.\n' +
  '5. Never guess and never infer a figure that is not written. An empty array is the correct answer more often than not.\n' +
  '6. Output MUST be valid JSON.';

/**
 * Asks the model what price fact (if any) the agent stated. Returns []
 * on any failure — a learning miss must never surface to the agent, who
 * is mid-conversation and did not ask for this.
 */
export async function extractPriceFacts(
  accountId: string,
  text: string
): Promise<ExtractedPriceFact[]> {
  try {
    const burn = await burnCredits(
      accountId,
      AI_FEATURE,
      AI_FEATURE_COSTS[AI_FEATURE],
      {
        hardBlock: false,
      }
    );
    if (burn.deficit !== 0) return [];
  } catch (err) {
    console.error('[chat-learning] credit burn failed:', err);
    return [];
  }

  try {
    const raw = await generateJson(
      `Agent's message:\n"${text}"`,
      SYSTEM_INSTRUCTION,
      { tier: 'lite', feature: AI_FEATURE }
    );
    const parsed = JSON.parse(raw) as { facts?: unknown };
    return sanitizePriceFacts(parsed.facts);
  } catch (err) {
    console.error('[chat-learning] extraction failed:', err);
    return [];
  }
}

/**
 * A fact worth asking about: one that is not already what the listing
 * says. Re-proposing the value already stored is noise in a review
 * queue, and a queue people stop reading learns nothing.
 */
export function isNewFact(
  fact: ExtractedPriceFact,
  property: Record<string, unknown>
): boolean {
  const current = property[fact.field];
  if (current === null || current === undefined) return true;
  return Number(current) !== fact.value;
}

/**
 * The listing an agent's message is about: the one most recently shared
 * with this contact. Same source of truth as questionSubjectProperty,
 * so a fact lands on the listing the buyer was asking about.
 */
async function subjectProperty(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<Record<string, unknown> | null> {
  const { data: share } = await db
    .from('property_shares')
    .select('property_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const propertyId = share?.property_id as string | undefined;
  if (!propertyId) return null;

  const { data: property } = await db
    .from('properties')
    .select(
      'id, price, area_sqft, seller_final_price, seller_final_price_per_sqft'
    )
    .eq('id', propertyId)
    .eq('account_id', accountId)
    .maybeSingle();

  return (property as Record<string, unknown> | null) ?? null;
}

export interface LearnFromAgentReplyArgs {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId: string | null;
  /** Our `messages.id` for the message being learned from. */
  messageId: string | null;
  text: string;
}

/**
 * Walks the gates and records what survives as a pending suggestion.
 * Returns the number of suggestions written.
 *
 * Never throws: this runs after a message has already reached the
 * buyer, so nothing here may fail the send it follows.
 */
export async function learnFromAgentReply(
  args: LearnFromAgentReplyArgs
): Promise<number> {
  const { db, accountId, contactId, conversationId, messageId, text } = args;

  try {
    if (!carriesPriceFactSignal(text)) return 0;

    const property = await subjectProperty(db, accountId, contactId);
    if (!property) return 0;

    const facts = (await extractPriceFacts(accountId, text)).filter((f) =>
      isNewFact(f, property)
    );
    if (!facts.length) return 0;

    // Replaces any open suggestion for the same field — the latest
    // thing the agent said is the one worth confirming. Reviewed rows
    // are left alone, so the audit trail survives.
    const propertyId = property.id as string;
    const { error: clearErr } = await db
      .from('property_fact_suggestions')
      .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('property_id', propertyId)
      .eq('status', 'pending')
      .in(
        'field',
        facts.map((f) => f.field)
      );
    if (clearErr) throw clearErr;

    const { error: insertErr } = await db
      .from('property_fact_suggestions')
      .insert(
        facts.map((f) => ({
          account_id: accountId,
          property_id: propertyId,
          contact_id: contactId,
          conversation_id: conversationId,
          message_id: messageId,
          field: f.field,
          current_value: (property[f.field] as number | null) ?? null,
          suggested_value: f.value,
          evidence: text.slice(0, 2000),
          status: 'pending',
        }))
      );
    if (insertErr) throw insertErr;

    return facts.length;
  } catch (err) {
    console.error(
      '[chat-learning] learnFromAgentReply failed (non-fatal):',
      err
    );
    return 0;
  }
}
