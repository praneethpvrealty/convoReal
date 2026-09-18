import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  clampRecentDays,
  notifyRecentContacts,
  numberChangeWindow,
} from '@/lib/whatsapp/number-change-notice';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = await checkRateLimit(
      `admin:numberChangeNotify:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as { days?: unknown };
    const days = clampRecentDays(body.days);

    const { data: config, error } = await ctx.supabase
      .from('whatsapp_config')
      .select(
        'phone_number_id, integration_type, previous_display_phone_number, number_changed_at'
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;

    const window = numberChangeWindow(config);
    if (!window.active) {
      return NextResponse.json(
        {
          error:
            'The number has not changed in the last 7 days, so there is nothing to announce.',
        },
        { status: 409 }
      );
    }

    const data = await notifyRecentContacts({
      userDb: ctx.supabase,
      adminDb: supabaseAdmin(),
      accountId: ctx.accountId,
      window,
      days,
      businessName: ctx.account.name,
      accountLanguage: ctx.account.defaultLanguage,
      send: sendWhatsAppMessageAndPersist,
    });
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
