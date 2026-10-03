import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  computeBillingSummary,
  toMonthlyPoints,
  type BillingAnalyticsRaw,
} from '@/lib/billing/analytics';

export async function GET() {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }
  try {
    const admin = supabaseAdmin();
    const { data, error } = await admin.rpc('billing_analytics', {
      p_months: 12,
    });

    if (error) {
      console.error('[GET /api/admin/billing-analytics] rpc error:', error);
      return NextResponse.json(
        { error: 'Failed to load billing analytics' },
        { status: 500 }
      );
    }

    const raw = (data ?? {}) as Partial<BillingAnalyticsRaw>;
    const plans = raw.plans ?? [];

    return NextResponse.json({
      summary: computeBillingSummary(plans),
      plans,
      monthly: toMonthlyPoints(raw.monthly ?? []),
      recentEvents: raw.recent_events ?? [],
    });
  } catch (error) {
    console.error('Error in GET admin billing analytics:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
