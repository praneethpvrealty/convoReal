// ============================================================
// /api/admin/copilot-usage — platform-wide copilot adoption.
//
// GET: last-30-day rollup of copilot_events, aggregated in SQL by
// copilot_usage_summary() (migration 245) so no raw event rows ever
// travel. Super-admin only, service-role client — same posture as
// /api/admin/copilot-demand.
// ============================================================

import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';

import { supabaseAdmin } from '@/lib/supabase/admin';

const WINDOW_DAYS = 30;


export interface CopilotUsageRow {
  event: string;
  platform: string;
  audience: string;
  events: number;
  users: number;
  accounts: number;
}

export async function GET() {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

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
