import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
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

const CONFIG_COLUMNS =
  'agent_ref, phone_number, webhook_token, is_active, reminder_calls_enabled, updated_at';

// GET /api/voice-config — the account's voice provider configuration
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data } = await ctx.supabase
      .from('voice_agent_config')
      .select(CONFIG_COLUMNS)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    return NextResponse.json({ data: data ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PUT /api/voice-config — create or update; admin only
export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireRole('admin');

    const limit = await checkRateLimit(
      `admin:voiceConfig:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const patch: Record<string, unknown> = { account_id: ctx.accountId };
    if (typeof body.agent_ref === 'string') {
      patch.agent_ref = body.agent_ref.trim() || null;
    }
    if (typeof body.phone_number === 'string') {
      patch.phone_number = body.phone_number.trim() || null;
    }
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;
    if (typeof body.reminder_calls_enabled === 'boolean') {
      patch.reminder_calls_enabled = body.reminder_calls_enabled;
    }
    if (body.regenerate_token === true) {
      patch.webhook_token = randomBytes(24).toString('hex');
    }

    const { data, error } = await ctx.supabase
      .from('voice_agent_config')
      .upsert(patch, { onConflict: 'account_id' })
      .select(CONFIG_COLUMNS)
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || 'Failed to save configuration' },
        { status: 500 }
      );
    }
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
