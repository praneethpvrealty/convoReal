import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { SIGNUP_GATES, SIGNUP_STAGES } from '@/lib/auth/signup-attempt';

// POST /api/public/signup-attempt
// Records one stage of a visit to /signup. Public and unauthenticated
// by necessity: the whole point is the people who never became users.
//
// Nothing here may break a signup. A refused write, a missing table, a
// rate limit — all return 200 and are dropped, because the caller
// fires this alongside the real auth call and must never surface it.

const SESSION_LIMIT = { limit: 10, windowMs: 60_000 };
const GLOBAL_LIMIT = { limit: 120, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      session_key?: string;
      stage?: string;
      gate?: string;
      email?: string;
      error_message?: string;
    } | null;

    const sessionKey = (body?.session_key || '').trim().slice(0, 64);
    const stage = (body?.stage || '').trim();
    const gate = (body?.gate || '').trim();

    if (
      !sessionKey ||
      !SIGNUP_STAGES.includes(stage as (typeof SIGNUP_STAGES)[number]) ||
      !SIGNUP_GATES.includes(gate as (typeof SIGNUP_GATES)[number])
    ) {
      return NextResponse.json({ error: 'Invalid attempt' }, { status: 400 });
    }

    const s = checkRateLimit(`signupattempt:session:${sessionKey}`, SESSION_LIMIT);
    if (!s.success) return rateLimitResponse(s);
    const g = checkRateLimit('signupattempt:global', GLOBAL_LIMIT);
    if (!g.success) return rateLimitResponse(g);

    // A landing has no address to record; only a submitted form does.
    const email =
      stage === 'landed' ? null : (body?.email || '').trim().slice(0, 254) || null;

    const { error } = await supabaseAdmin().from('signup_attempts').insert({
      session_key: sessionKey,
      stage,
      gate,
      email,
      error_message: (body?.error_message || '').trim().slice(0, 300) || null,
      referrer: (request.headers.get('referer') || '').slice(0, 500) || null,
      user_agent: (request.headers.get('user-agent') || '').slice(0, 300) || null,
    });

    if (error) {
      console.error('[POST /api/public/signup-attempt] Insert failed:', error);
      return NextResponse.json({ success: false });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/public/signup-attempt] Unexpected error:', err);
    return NextResponse.json({ success: false });
  }
}
