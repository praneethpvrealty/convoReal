import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  broadcastTemplateStateResponse,
  ensureBroadcastUpdateTemplate,
  readBroadcastUpdateTemplateState,
} from '@/lib/whatsapp/broadcast-update-template';

// GET /api/broadcasts/template — the state of the template every
// hand-written broadcast rides on, without triggering a Meta submission.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const state = await readBroadcastUpdateTemplateState(
      ctx.supabase,
      ctx.accountId
    );
    return NextResponse.json({
      data: broadcastTemplateStateResponse(state, ctx.account.name),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/broadcasts/template — submit the canned carrier template to
// Meta when the account has no row for it yet. The composer calls this
// on its own the first time it opens, so no one has to know it exists.
// The payload carries no caller-supplied content, which is why this sits
// at the agent role rather than org_manager like free-form submission;
// it still creates a template at Meta and a workspace row, so a
// read-only member is refused before either happens.
export async function POST() {
  try {
    const ctx = await requireWriteRole('agent');

    const limit = await checkRateLimit(
      `broadcasts:template:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const state = await ensureBroadcastUpdateTemplate(ctx.accountId);
    return NextResponse.json({
      data: broadcastTemplateStateResponse(state, ctx.account.name),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
