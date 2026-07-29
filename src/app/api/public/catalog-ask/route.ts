import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { captureVisitorLead } from '@/lib/showcase/visitor-lead';
import { generateText } from '@/lib/ai/gemini';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import {
  answerFromCatalog,
  buildCatalogContext,
  CATALOG_QA_SYSTEM_PROMPT,
  type CatalogListing,
} from '@/lib/showcase/catalog-qa';

// POST /api/public/catalog-ask
// Catalog-wide sibling of /api/public/ask, for the showcase lead bot:
// the visitor is asking across the agency's whole inventory rather than
// about the one listing they have open.
//
// Same layered defenses, for the same reason (the AI path spends the
// AGENT'S credits, so an anonymous visitor must not be able to drain a
// wallet):
//   1. Per-session AND per-account rate limits.
//   2. Aggregate answers from the live catalog are served for FREE.
//   3. The AI path is gated behind phone capture (which doubles as lead
//      capture) so anonymous traffic can't trigger paid calls.
//   4. Credits are soft-burned BEFORE the AI call; if the account can't
//      cover it the visitor is handed to WhatsApp, never shown an error.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUESTION_LEN = 500;
const AI_FEATURE = 'chatbot_auto_reply' as const;

const ASK_SESSION_LIMIT = { limit: 20, windowMs: 60_000 };
const ASK_ACCOUNT_LIMIT = { limit: 120, windowMs: 60_000 };

// Enough of the catalog to answer honestly, capped so a large inventory
// can't blow out the prompt.
const CATALOG_FETCH_LIMIT = 60;
const CATALOG_CONTEXT_LIMIT = 40;

const QA_COLUMNS = [
  'title',
  'type',
  'listing_type',
  'price',
  'rent_per_month',
  'location',
  'sublocality',
  'city',
  'bedrooms',
  'bathrooms',
  'area_sqft',
  'area_unit',
  'land_area',
  'land_area_unit',
  'property_code',
  'project',
  'features',
  'roi',
].join(', ');

const HANDOFF_MESSAGE =
  "I'll get the agent to answer this one — tap the WhatsApp button and they'll help you personally.";
const NEEDS_PHONE_MESSAGE =
  "Share your number and I'll dig through the full inventory for you (the agent can follow up with anything I miss).";

interface AskCriteria {
  intent?: string;
  category?: string;
  localities?: string[];
  budget?: { min?: number | null; max?: number | null };
}

/** Puts listings the visitor has already described first, so the model
 *  sees the relevant slice of a large catalog inside the context cap. */
function preferMatching(
  listings: CatalogListing[],
  criteria: AskCriteria | undefined
): CatalogListing[] {
  const tokens = [criteria?.category, ...(criteria?.localities || [])]
    .filter((t): t is string => Boolean(t && t.trim()))
    .map((t) => t.toLowerCase());
  if (!tokens.length) return listings;

  return [...listings].sort(
    (a, b) => relevance(b, tokens) - relevance(a, tokens)
  );
}

function relevance(listing: CatalogListing, tokens: string[]): number {
  const haystack = [
    listing.type,
    listing.title,
    listing.sublocality,
    listing.location,
    listing.city,
    listing.project,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return tokens.filter((t) => haystack.includes(t)).length;
}

function criteriaNote(criteria: AskCriteria | undefined): string {
  if (!criteria) return '';
  const bits = [
    criteria.intent ? `intent ${criteria.intent}` : null,
    criteria.category ? `looking for ${criteria.category}` : null,
    criteria.localities?.length ? `in ${criteria.localities.join(', ')}` : null,
    criteria.budget?.max
      ? `budget up to ₹${criteria.budget.max.toLocaleString('en-IN')}`
      : null,
  ].filter(Boolean);
  return bits.length ? ` (${bits.join('; ')})` : '';
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      account_id?: string;
      question?: string;
      session_key?: string;
      visitor_phone?: string;
      visitor_name?: string;
      criteria?: AskCriteria;
    } | null;

    const accountId = body?.account_id;
    const question = (body?.question || '').trim().slice(0, MAX_QUESTION_LEN);
    const sessionKey = (body?.session_key || '').slice(0, 64);

    if (!accountId || !UUID_RE.test(accountId) || !question || !sessionKey) {
      return NextResponse.json(
        { error: 'Missing or invalid required fields' },
        { status: 400 }
      );
    }

    const sessionLimit = checkRateLimit(
      `catalogask:session:${sessionKey}`,
      ASK_SESSION_LIMIT
    );
    if (!sessionLimit.success) return rateLimitResponse(sessionLimit);
    const accountLimit = checkRateLimit(
      `catalogask:account:${accountId}`,
      ASK_ACCOUNT_LIMIT
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const db = supabaseAdmin();

    const { data: listings } = await db
      .from('properties')
      .select(QA_COLUMNS)
      .eq('account_id', accountId)
      .eq('is_published', true)
      .eq('status', 'Available')
      .order('created_at', { ascending: false })
      .limit(CATALOG_FETCH_LIMIT);

    const catalog = (listings || []) as unknown as CatalogListing[];
    if (!catalog.length) {
      return NextResponse.json({
        answer: null,
        escalate_whatsapp: true,
        message: HANDOFF_MESSAGE,
      });
    }

    const structured = answerFromCatalog(question, catalog);
    if (structured.answer) {
      return NextResponse.json({
        answer: structured.answer,
        source: 'listing',
        intent: structured.intent,
      });
    }

    const rawPhone = (body?.visitor_phone || '').trim();
    if (!rawPhone) {
      return NextResponse.json({
        answer: null,
        needs_phone: true,
        message: NEEDS_PHONE_MESSAGE,
      });
    }
    const phone = normalizePhoneWithCountryCode(rawPhone);
    if (!phone) {
      return NextResponse.json({
        answer: null,
        needs_phone: true,
        message:
          'That number looks off — please re-enter it with your area code.',
      });
    }

    let burnCovered = false;
    try {
      const burn = await burnCredits(
        accountId,
        AI_FEATURE,
        AI_FEATURE_COSTS[AI_FEATURE],
        { hardBlock: false }
      );
      burnCovered = burn.deficit === 0;
    } catch (err) {
      console.error('[POST /api/public/catalog-ask] credit burn failed:', err);
      burnCovered = false;
    }

    void captureVisitorLead(db, {
      accountId,
      phone,
      name: body?.visitor_name,
      referrer: 'Showcase Assistant',
      sessionKey,
      propertyInterests: body?.criteria?.category
        ? [body.criteria.category]
        : undefined,
      areasOfInterest: body?.criteria?.localities,
      maxBudget: body?.criteria?.budget?.max ?? null,
      note: `Showcase assistant — asked${criteriaNote(body?.criteria)}: "${question.slice(0, 280)}"`,
    });

    if (!burnCovered) {
      return NextResponse.json({
        answer: null,
        escalate_whatsapp: true,
        message: HANDOFF_MESSAGE,
      });
    }

    try {
      const context = buildCatalogContext(
        preferMatching(catalog, body?.criteria),
        CATALOG_CONTEXT_LIMIT
      );
      const prompt = `Listings currently available:\n${context}\n\nVisitor's question: ${question}\n\nAnswer:`;
      const raw = await generateText(prompt, CATALOG_QA_SYSTEM_PROMPT, {
        feature: 'public_catalog_ask',
      });
      const answer = (raw || '').trim();
      if (!answer) {
        return NextResponse.json({
          answer: null,
          escalate_whatsapp: true,
          message: HANDOFF_MESSAGE,
        });
      }
      return NextResponse.json({ answer, source: 'ai' });
    } catch (err) {
      console.error(
        '[POST /api/public/catalog-ask] AI generation failed:',
        err
      );
      return NextResponse.json({
        answer: null,
        escalate_whatsapp: true,
        message: HANDOFF_MESSAGE,
      });
    }
  } catch (err) {
    console.error('[POST /api/public/catalog-ask] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
