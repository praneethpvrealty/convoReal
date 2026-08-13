import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { generateText } from '@/lib/ai/gemini';
import {
  answerFromSiteData,
  buildSiteContext,
  SITE_QA_SYSTEM_PROMPT,
} from '@/lib/marketing/site-qa';

// POST /api/public/site-ask
// Product Q&A for the marketing-site lead bot. Unlike the showcase's
// /api/public/ask, the cost here is ConvoReal's own, not a customer's —
// so there is no credit burn and no phone gate: making a prospect hand
// over a number before we'll answer "what does it cost?" is how you
// lose the prospect. Abuse is bounded instead by:
//   1. Deterministic answers from the marketing config for the common
//      questions — the majority of traffic never reaches the model.
//   2. Per-session and global rate limits, both deliberately tight.

const MAX_QUESTION_LEN = 400;

const ASK_SESSION_LIMIT = { limit: 15, windowMs: 60_000 };
const ASK_GLOBAL_LIMIT = { limit: 200, windowMs: 60_000 };

const HANDOFF_MESSAGE =
  'Good question — let me get you a proper answer. Leave your number and the team will walk you through it on WhatsApp.';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      question?: string;
      session_key?: string;
    } | null;

    const question = (body?.question || '').trim().slice(0, MAX_QUESTION_LEN);
    const sessionKey = (body?.session_key || '').slice(0, 64);

    if (!question) {
      return NextResponse.json({ error: 'Missing question' }, { status: 400 });
    }

    if (sessionKey) {
      const sessionLimit = await checkRateLimit(
        `siteask:session:${sessionKey}`,
        ASK_SESSION_LIMIT
      );
      if (!sessionLimit.success) return rateLimitResponse(sessionLimit);
    }
    const globalLimit = await checkRateLimit('siteask:global', ASK_GLOBAL_LIMIT);
    if (!globalLimit.success) return rateLimitResponse(globalLimit);

    const structured = answerFromSiteData(question);
    if (structured.answer) {
      return NextResponse.json({
        answer: structured.answer,
        source: 'config',
        intent: structured.intent,
      });
    }

    try {
      const prompt = `Product information:\n${buildSiteContext()}\n\nVisitor's question: ${question}\n\nAnswer:`;
      const raw = await generateText(prompt, SITE_QA_SYSTEM_PROMPT, {
        tier: 'lite',
        feature: 'public_site_ask',
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
      console.error('[POST /api/public/site-ask] AI generation failed:', err);
      return NextResponse.json({
        answer: null,
        escalate_whatsapp: true,
        message: HANDOFF_MESSAGE,
      });
    }
  } catch (err) {
    console.error('[POST /api/public/site-ask] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
