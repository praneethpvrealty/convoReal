import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

// GET /api/contacts/consent-counts — how many contacts sit in each
// WhatsApp-alerts consent state. Aggregated in SQL (migration 284)
// rather than counted from the client, per AGENTS.md §2.6, and shared
// by the web and mobile greeting send dialogs.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .rpc('account_alerts_consent_counts', { p_account_id: ctx.accountId })
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const row = (data ?? {}) as {
      pending?: number | string | null;
      granted?: number | string | null;
      declined?: number | string | null;
    };
    const count = (value: number | string | null | undefined) =>
      typeof value === 'number' ? value : Number(value ?? 0) || 0;

    return NextResponse.json({
      data: {
        pending: count(row.pending),
        granted: count(row.granted),
        declined: count(row.declined),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
