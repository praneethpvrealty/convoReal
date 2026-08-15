import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  OCCASION_GREETING_TEMPLATE_NAME,
  ensureOccasionGreetingTemplate,
} from '@/lib/whatsapp/occasion-greeting-template';

// GET /api/greetings/template — the account's occasion_greeting
// template state, without triggering a Meta submission.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('message_templates')
      .select('status, category, rejection_reason, last_submitted_at')
      .eq('account_id', ctx.accountId)
      .eq('name', OCCASION_GREETING_TEMPLATE_NAME)
      .order('last_submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      data: {
        status: data ? String(data.status ?? '').toUpperCase() : null,
        category: data?.category ?? null,
        rejectionReason: data?.rejection_reason ?? null,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/greetings/template — submit the predefined greeting
// template to Meta if the account has no row for it yet. The payload is
// canned (no caller-supplied content), which is why this sits at the
// agent role rather than org_manager like free-form template submission.
export async function POST() {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `greetings:template:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const state = await ensureOccasionGreetingTemplate(ctx.accountId);
    return NextResponse.json({
      data: {
        status: state.status,
        rejectionReason: state.rejectionReason,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
