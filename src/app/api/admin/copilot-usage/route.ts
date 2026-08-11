// ============================================================
// /api/admin/copilot-usage — platform-wide copilot adoption.
//
// GET: last-30-day rollup of copilot_events, aggregated in SQL by
// copilot_usage_summary() (migration 243) so no raw event rows ever
// travel. Super-admin only, service-role client — same posture as
// /api/admin/copilot-demand.
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const WINDOW_DAYS = 30;

async function requireSuperAdmin(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, status: 401, body: { error: 'Unauthorized' } };
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profile?.role !== 'super_admin') {
    return { ok: false as const, status: 403, body: { error: 'Forbidden' } };
  }
  return { ok: true as const };
}

export interface CopilotUsageRow {
  event: string;
  platform: string;
  audience: string;
  events: number;
  users: number;
  accounts: number;
}

export async function GET() {
  const supabase = await createClient();
  const guard = await requireSuperAdmin(supabase);
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const since = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabaseAdmin().rpc('copilot_usage_summary', {
    p_since: since,
  });

  if (error) {
    // Pre-migration deployments report an empty rollup, not a 500 —
    // the tab renders its zero state with a hint instead of an error.
    console.warn(
      '[GET /api/admin/copilot-usage] rollup failed:',
      error.message
    );
    return NextResponse.json({ usage: [], windowDays: WINDOW_DAYS });
  }

  return NextResponse.json({
    usage: (data ?? []) as CopilotUsageRow[],
    windowDays: WINDOW_DAYS,
  });
}
