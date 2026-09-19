import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { NUMBER_CHANGE_TEMPLATE_NAME } from '@/lib/whatsapp/number-change-template';
import {
  clampRecentDays,
  loadNumberChangeAudience,
  numberChangeWindow,
} from '@/lib/whatsapp/number-change-notice';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const days = clampRecentDays(new URL(request.url).searchParams.get('days'));

    const { data: config, error } = await ctx.supabase
      .from('whatsapp_config')
      .select(
        'phone_number_id, integration_type, previous_display_phone_number, number_changed_at'
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;

    const window = numberChangeWindow(config);
    if (!window.active || !window.phoneNumberId || !window.changedAt) {
      return NextResponse.json({ data: { ...window, days } });
    }

    const [audience, notified, template] = await Promise.all([
      loadNumberChangeAudience(ctx.supabase, {
        accountId: ctx.accountId,
        phoneNumberId: window.phoneNumberId,
        changedAt: window.changedAt,
        days,
      }),
      ctx.supabase
        .from('whatsapp_number_change_notices')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .eq('phone_number_id', window.phoneNumberId)
        .not('sent_at', 'is', null),
      ctx.supabase
        .from('message_templates')
        .select('status, language')
        .eq('account_id', ctx.accountId)
        .eq('name', NUMBER_CHANGE_TEMPLATE_NAME)
        .order('last_submitted_at', { ascending: false, nullsFirst: false }),
    ]);

    const statuses = (template.data ?? []) as {
      status: string | null;
      language: string | null;
    }[];
    return NextResponse.json({
      data: {
        ...window,
        days,
        audienceCount: audience.length,
        notifiedCount: notified.count ?? 0,
        templateStatus: statuses.some((t) => t.status === 'APPROVED')
          ? 'approved'
          : statuses.length > 0
            ? 'pending'
            : 'missing',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
