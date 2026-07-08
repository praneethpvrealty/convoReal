import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { findOrCreateContact } from '@/lib/contacts/find-or-create';
import { generateText } from '@/lib/ai/gemini';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import {
  answerFromPropertyData,
  buildPropertyContext,
  PROPERTY_QA_SYSTEM_PROMPT,
  type QaProperty,
} from '@/lib/showcase/property-qa';

// POST /api/public/ask
// Public "Ask about this property" endpoint for the buyer showcase.
//
// The showcase is unauthenticated, so this is too. Layered defenses in
// place of auth (the AI path spends the AGENT'S credits, so an
// anonymous visitor must not be able to drain a wallet):
//   1. Per-session AND per-account rate limits.
//   2. Structured answers from listing fields are served for FREE —
//      no AI, no credit cost — and handle the common questions.
//   3. The AI path is gated behind phone capture (which doubles as
//      lead capture) so anonymous traffic can't trigger paid calls.
//   4. Credits are soft-burned BEFORE the AI call; if the account
//      can't cover it, the buyer is handed off to WhatsApp instead of
//      seeing an error (external engine stays soft — see
//      credit-gating-design). The buyer never sees "out of credits".

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUESTION_LEN = 500;
const AI_FEATURE = 'chatbot_auto_reply' as const;

// A device (session) can ask often; the per-account cap bounds total
// AI spend even if a bad actor rotates session keys.
const ASK_SESSION_LIMIT = { limit: 20, windowMs: 60_000 };
const ASK_ACCOUNT_LIMIT = { limit: 120, windowMs: 60_000 };

// Columns needed to answer + to attribute a captured lead. No private
// fields (documents, notes, owner contact) are selected.
const QA_COLUMNS = [
  'id', 'account_id', 'user_id', 'title', 'type', 'listing_type',
  'price', 'rent_per_month', 'maintenance', 'advance', 'gst',
  'location', 'sublocality', 'city', 'state', 'bedrooms', 'bathrooms',
  'area_sqft', 'area_unit', 'super_built_area', 'land_area',
  'land_area_unit', 'facing_direction', 'features', 'nearby_highlights',
  'property_code', 'project', 'rental_income', 'roi', 'dimensions',
].join(', ');

const HANDOFF_MESSAGE =
  "I'll connect you with the agent for this one — tap the WhatsApp button and they'll help you personally.";
const NEEDS_PHONE_MESSAGE =
  "Share your number and the agent's assistant will answer this for you (and the agent can follow up).";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      account_id?: string;
      property_id?: string;
      question?: string;
      session_key?: string;
      visitor_phone?: string;
      visitor_name?: string;
    } | null;

    const accountId = body?.account_id;
    const propertyId = body?.property_id;
    const question = (body?.question || '').trim().slice(0, MAX_QUESTION_LEN);
    const sessionKey = (body?.session_key || '').slice(0, 64);

    if (!accountId || !UUID_RE.test(accountId) || !propertyId || !UUID_RE.test(propertyId) || !question || !sessionKey) {
      return NextResponse.json({ error: 'Missing or invalid required fields' }, { status: 400 });
    }

    // 1. Rate limits — per session, then per account.
    const sessionLimit = checkRateLimit(`ask:session:${sessionKey}`, ASK_SESSION_LIMIT);
    if (!sessionLimit.success) return rateLimitResponse(sessionLimit);
    const accountLimit = checkRateLimit(`ask:account:${accountId}`, ASK_ACCOUNT_LIMIT);
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const db = supabaseAdmin();

    // 2. Load the property — scoped to the account, published & available
    //    only. A forged property_id from another tenant finds nothing.
    const { data: property } = await db
      .from('properties')
      .select(QA_COLUMNS)
      .eq('id', propertyId)
      .eq('account_id', accountId)
      .eq('is_published', true)
      .eq('status', 'Available')
      .maybeSingle<QaProperty & { id: string; account_id: string; user_id: string | null }>();

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    // 3. Free structured answer first — covers the common questions with
    //    zero AI cost and zero abuse surface.
    const structured = answerFromPropertyData(question, property);
    if (structured.answer) {
      return NextResponse.json({ answer: structured.answer, source: 'listing', intent: structured.intent });
    }

    // 4. Open-ended question → AI path, but only once we have a phone.
    const rawPhone = (body?.visitor_phone || '').trim();
    if (!rawPhone) {
      return NextResponse.json({ answer: null, needs_phone: true, message: NEEDS_PHONE_MESSAGE });
    }
    const phone = normalizePhoneWithCountryCode(rawPhone, '91');
    if (!phone) {
      return NextResponse.json({ answer: null, needs_phone: true, message: 'That number looks off — please re-enter it with your area code.' });
    }

    // 5. Soft-burn the agent's credits BEFORE the AI call. If the
    //    account can't fully cover it, hand off to WhatsApp instead of
    //    calling (and paying for) Gemini — the buyer never sees an error.
    let burnCovered = false;
    try {
      const burn = await burnCredits(accountId, AI_FEATURE, AI_FEATURE_COSTS[AI_FEATURE], { hardBlock: false });
      burnCovered = burn.deficit === 0;
    } catch (err) {
      console.error('[POST /api/public/ask] credit burn failed:', err);
      burnCovered = false;
    }

    // Capture the lead regardless of whether we answer with AI — the
    // buyer gave us a phone number. Best-effort; never blocks the reply.
    void captureLead(db, property, phone, body?.visitor_name, question);

    if (!burnCovered) {
      return NextResponse.json({ answer: null, escalate_whatsapp: true, message: HANDOFF_MESSAGE });
    }

    // 6. AI answer grounded in the listing.
    try {
      const prompt = `Property details:\n${buildPropertyContext(property)}\n\nBuyer's question: ${question}\n\nAnswer:`;
      const raw = await generateText(prompt, PROPERTY_QA_SYSTEM_PROMPT);
      const answer = (raw || '').trim();
      if (!answer) {
        return NextResponse.json({ answer: null, escalate_whatsapp: true, message: HANDOFF_MESSAGE });
      }
      return NextResponse.json({ answer, source: 'ai' });
    } catch (err) {
      console.error('[POST /api/public/ask] AI generation failed:', err);
      return NextResponse.json({ answer: null, escalate_whatsapp: true, message: HANDOFF_MESSAGE });
    }
  } catch (err) {
    console.error('[POST /api/public/ask] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Best-effort Buyer lead capture: attributes the contact to the
 * property's managing agent (falling back to the account owner) and
 * links the property they asked about. Swallows all errors — a lead
 * write must never break the buyer's answer.
 */
async function captureLead(
  db: ReturnType<typeof supabaseAdmin>,
  property: { id: string; account_id: string; user_id: string | null; title: string },
  phone: string,
  name: string | undefined,
  question: string,
): Promise<void> {
  try {
    let userId = property.user_id;
    if (!userId) {
      const { data: account } = await db
        .from('accounts')
        .select('owner_user_id')
        .eq('id', property.account_id)
        .maybeSingle();
      userId = account?.owner_user_id ?? null;
    }
    if (!userId) return;

    // Note: `source` is deliberately not set — find-or-create overwrites
    // it on every call, which would clobber an existing contact's
    // original attribution (e.g. a prior "Website Showcase" inquiry) each
    // time they ask another question. `referrer` is write-once on create.
    const { contactId } = await findOrCreateContact(db, {
      accountId: property.account_id,
      userId,
      phone,
      name: name?.trim() || 'Showcase Visitor',
      classification: 'Buyer',
      referrer: 'Showcase Q&A',
      lastInquiredPropertyId: property.id,
    });

    // Append the actual question as a note (insert, so repeat questions
    // accumulate rather than overwrite) — the agent sees what the buyer
    // wanted to know.
    await db.from('contact_notes').insert({
      account_id: property.account_id,
      contact_id: contactId,
      user_id: userId,
      note_text: `Showcase Q&A — asked about "${property.title}": "${question.slice(0, 280)}"`,
    });
  } catch (err) {
    console.error('[POST /api/public/ask] lead capture failed (non-fatal):', err);
  }
}
