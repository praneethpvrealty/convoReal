import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

const RANGES = new Set([7, 30, 90]);

function safeTimeZone(raw: string | null): string {
  if (!raw) return 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en', { timeZone: raw });
    return raw;
  } catch {
    return 'Asia/Kolkata';
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const daysRaw = Number(searchParams.get('days'));
    const days = RANGES.has(daysRaw) ? daysRaw : 30;
    const timeZone = safeTimeZone(searchParams.get('tz'));
    const start = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    ).toISOString();

    const base = { p_account_id: ctx.accountId, p_start: start };
    const [summary, series, dispositions, funnel, skips] = await Promise.all([
      ctx.supabase.rpc('call_analytics_summary', base).maybeSingle(),
      ctx.supabase.rpc('call_analytics_series', {
        ...base,
        p_time_zone: timeZone,
      }),
      ctx.supabase.rpc('call_analytics_dispositions', base),
      ctx.supabase.rpc('call_followup_funnel', base).maybeSingle(),
      ctx.supabase.rpc('call_followup_skips', base),
    ]);
    const failed =
      summary.error ||
      series.error ||
      dispositions.error ||
      funnel.error ||
      skips.error;
    if (failed) {
      return NextResponse.json({ error: failed.message }, { status: 500 });
    }

    type SummaryRow = Record<string, number | string | null>;
    const s = (summary.data ?? {}) as SummaryRow;
    const f = (funnel.data ?? {}) as SummaryRow;
    const n = (v: unknown) => Number(v) || 0;

    return NextResponse.json({
      data: {
        days,
        summary: {
          total: n(s.total),
          connected: n(s.connected),
          noAnswer: n(s.no_answer),
          busy: n(s.busy),
          voicemail: n(s.voicemail),
          wrongNumber: n(s.wrong_number),
          callbackRequested: n(s.callback_requested),
          voiceAgent: n(s.voice_agent),
          manual: n(s.manual),
          inbound: n(s.inbound),
          outbound: n(s.outbound),
          avgDurationSeconds: s.avg_duration_seconds
            ? Math.round(Number(s.avg_duration_seconds))
            : null,
          totalDurationSeconds: n(s.total_duration_seconds),
        },
        series: ((series.data ?? []) as Record<string, unknown>[]).map(
          (row) => ({
            day: String(row.day),
            total: n(row.total),
            connected: n(row.connected),
          })
        ),
        dispositions: (
          (dispositions.data ?? []) as Record<string, unknown>[]
        ).map((row) => ({
          disposition: String(row.disposition),
          calls: n(row.calls),
          followupsSent: n(row.followups_sent),
          followupsOpened: n(row.followups_opened),
        })),
        funnel: {
          total: n(f.total),
          sent: n(f.sent),
          opened: n(f.opened),
          completed: n(f.completed),
          skipped: n(f.skipped),
          failed: n(f.failed),
          scheduled: n(f.scheduled),
        },
        skips: ((skips.data ?? []) as Record<string, unknown>[]).map((row) => ({
          reason: String(row.skip_reason),
          followups: n(row.followups),
        })),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
