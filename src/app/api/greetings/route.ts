import { NextRequest, NextResponse } from 'next/server';
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
import { GREETING_MESSAGE_MAX } from '@/lib/greetings/generate';
import { occasionById } from '@/lib/greetings/occasions';

const LABEL_MAX = 80;

// GET /api/greetings — the account's occasion greetings
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('occasion_greetings')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/greetings — save a greeting draft
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `greetings:create:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const occasionLabel = String(body?.occasionLabel ?? '').trim();
    const messageText = String(body?.messageText ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const occasionId =
      typeof body?.occasionId === 'string' && occasionById(body.occasionId)
        ? body.occasionId
        : null;
    const imagePath =
      typeof body?.imagePath === 'string' && body.imagePath.trim()
        ? body.imagePath.trim()
        : null;

    if (!occasionLabel || !messageText) {
      return NextResponse.json(
        { error: 'occasionLabel and messageText are required' },
        { status: 400 }
      );
    }
    if (occasionLabel.length > LABEL_MAX) {
      return NextResponse.json(
        { error: `Occasion name must stay under ${LABEL_MAX} characters` },
        { status: 400 }
      );
    }
    if (messageText.length > GREETING_MESSAGE_MAX) {
      return NextResponse.json(
        {
          error: `Greeting must stay under ${GREETING_MESSAGE_MAX} characters`,
        },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('occasion_greetings')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        occasion_id: occasionId,
        occasion_label: occasionLabel,
        message_text: messageText,
        image_path: imagePath,
        status: 'draft',
      })
      .select('*')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
