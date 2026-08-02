import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  computeBillingSummary,
  toMonthlyPoints,
  type BillingAnalyticsRaw,
} from '@/lib/billing/analytics';

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError || profile?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
