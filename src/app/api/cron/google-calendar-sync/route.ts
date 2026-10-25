import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { appBaseUrl } from '@/lib/google-calendar/oauth';
import {
  CONNECTION_COLUMNS,
  syncGoogleCalendar,
  type GoogleCalendarConnection,
} from '@/lib/google-calendar/sync';
import { supabaseAdmin } from '@/lib/supabase/admin';

const BATCH_SIZE = 40;
const TIME_BUDGET_MS = 240_000;

export const maxDuration = 300;

export async function GET(request: Request) {
  const expected =
    process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('google_calendar_connections')
    .select(CONNECTION_COLUMNS)
    .neq('status', 'token_expired')
    .order('last_attempted_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);
  if (error) {
    console.error('[google-calendar-sync] load failed:', error);
    return NextResponse.json({ error: 'load failed' }, { status: 500 });
  }

  const summary = { synced: 0, failed: 0, skipped: 0 };
  for (const connection of (data ?? []) as GoogleCalendarConnection[]) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      summary.skipped += 1;
      continue;
    }
    const result = await syncGoogleCalendar(admin, connection, appBaseUrl());
    if (result.status === 'synced') summary.synced += 1;
    else summary.failed += 1;
  }
  console.log('[google-calendar-sync]', JSON.stringify(summary));
  return NextResponse.json({ data: summary });
}
