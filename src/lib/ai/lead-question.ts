// ============================================================
// A lead's question on WhatsApp, answered the same way the public
// showcase answers one — and handed to a human when it can't be.
//
// The showcase has had this ladder for a while (/api/public/ask):
// deterministic answer from the listing's own fields first, Gemini
// grounded in those fields second. On WhatsApp the same buyer got
// nothing: "Can we see inside when we visit tomorrow" was read as a
// booking and re-acknowledged a visit that was already in the diary,
// and "which one is the one we are talking here" fell through to a
// keyword and restarted the welcome funnel.
//
// The ladder here is the showcase's, plus the rung it always needed:
// when neither tier can answer, say so honestly and put the question
// in front of an agent rather than guessing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  answerFromPropertyData,
  buildPropertyContext,
  PROPERTY_QA_SYSTEM_PROMPT,
  type QaProperty,
} from '@/lib/showcase/property-qa';
import { isLocationGuarded, localityLabel } from '@/lib/inventory/location-guard';
import { generateText } from '@/lib/ai/gemini';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';

/** Same feature key and price the public Ask endpoint burns. */
const AI_FEATURE = 'chatbot_auto_reply' as const;

/** What the lead hears when nobody but a human can answer. Deliberately
 *  promises a person, not a time — the agent decides that. */
export const HANDOVER_TEXT =
  "Good question — let me check that with the team and come right back to you.";

export type LeadAnswerSource = 'listing' | 'ai' | 'handover';

export interface LeadAnswer {
  text: string;
  source: LeadAnswerSource;
  /** The matched deterministic intent, for logging. */
  intent?: string | null;
}

/**
 * Is this text a question rather than an instruction?
 *
 * Used to keep question-shaped sentences out of the scheduling parser:
 * "can we see inside when we visit tomorrow" mentions tomorrow, but it
 * asks about access, it does not ask for a slot. Kept deliberately
 * conservative — an outright "book"/"schedule"/"remind me" is an
 * instruction even when phrased as a question ("can you schedule...").
 */
export function looksLikeQuestion(text: string | null | undefined): boolean {
  const t = (text || '').trim().toLowerCase();
  if (!t) return false;
  if (/\b(book|schedule|remind me|set up|arrange)\b/.test(t)) return false;
  if (t.includes('?')) return true;
  return /^(can|could|will|would|is|are|do|does|did|what|when|where|which|who|whom|why|how|any|shall|may)\b/.test(
    t,
  );
}

/**
 * The listing a question is about: the one most recently shared with
 * this contact. Same source of truth the template quick replies use, so
 * "more details" and "is it north facing?" resolve to the same property.
 */
export async function questionSubjectProperty(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<(QaProperty & { id: string }) | null> {
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
    .select('*')
    .eq('id', propertyId)
    .eq('account_id', accountId)
    .maybeSingle();
  return (property as (QaProperty & { id: string }) | null) ?? null;
}

/**
 * Walk the ladder. Never throws and never returns an empty string: the
 * worst case is the handover line, which is a real answer to the lead
 * even though it defers the substance to a person.
 *
 * A guarded listing is answered from its locality-substituted row, so
 * the Q&A can never leak an address the showcase itself withholds.
 */
export async function answerLeadQuestion(args: {
  accountId: string;
  question: string;
  property: QaProperty | null;
}): Promise<LeadAnswer> {
  const { accountId, question, property } = args;
  if (!property) return { text: HANDOVER_TEXT, source: 'handover' };

  const guarded = isLocationGuarded(property);
  const qaProperty = guarded
    ? { ...property, location: localityLabel(property) }
    : property;

  const structured = answerFromPropertyData(question, qaProperty);
  if (structured.answer) {
    const text =
      guarded && structured.intent === 'location'
        ? `${structured.answer} The exact address is shared on request.`
        : structured.answer;
    return { text, source: 'listing', intent: structured.intent };
  }

  // Soft burn before the call: an account out of credits hands over to
  // a human rather than failing, and never pays for a call we skip.
  try {
    const burn = await burnCredits(accountId, AI_FEATURE, AI_FEATURE_COSTS[AI_FEATURE], {
      hardBlock: false,
    });
    if (burn.deficit !== 0) return { text: HANDOVER_TEXT, source: 'handover' };
  } catch (err) {
    console.error('[lead-question] credit burn failed:', err);
    return { text: HANDOVER_TEXT, source: 'handover' };
  }

  try {
    const prompt = `Property details:\n${buildPropertyContext(qaProperty)}\n\nBuyer's question: ${question}\n\nAnswer:`;
    const raw = await generateText(prompt, PROPERTY_QA_SYSTEM_PROMPT, {
      feature: AI_FEATURE,
    });
    const answer = (raw || '').trim();
    // The system prompt tells Gemini to refuse rather than invent. A
    // refusal is a handover, not an answer.
    if (!answer || isNonAnswer(answer)) {
      return { text: HANDOVER_TEXT, source: 'handover' };
    }
    return { text: answer, source: 'ai' };
  } catch (err) {
    console.error('[lead-question] AI answer failed:', err);
    return { text: HANDOVER_TEXT, source: 'handover' };
  }
}

/** Gemini saying "I don't know" in the shapes the prompt invites. */
function isNonAnswer(answer: string): boolean {
  return /^(i (don'?t|do not) (know|have)|sorry[, ]|that information (is|isn'?t)|not (specified|available|mentioned)|no information)/i.test(
    answer.trim(),
  );
}
