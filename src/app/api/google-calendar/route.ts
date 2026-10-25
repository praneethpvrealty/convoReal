import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  appBaseUrl,
  googleOAuthCredentials,
} from '@/lib/google-calendar/oauth';
import {
  CONNECTION_COLUMNS,
  syncGoogleCalendar,
  type GoogleCalendarConnection,
} from '@/lib/google-calendar/sync';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const maxDuration = 300;

async function loadStatus(userId: string, accountId: string) {
  const { data, error } = await supabaseAdmin()
    .from('google_calendar_connections')
    .select('google_email, status, last_error, last_synced_at')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  return {
    configured: googleOAuthCredentials() !== null,
    connected: !!data,
    google_email: data?.google_email ?? null,
    status: data?.status ?? null,
    last_error: data?.last_error ?? null,
    last_synced_at: data?.last_synced_at ?? null,
  };
}

export async function GET() {
  try {
    const { userId, accountId } = await requireRole('viewer');
    return NextResponse.json({ data: await loadStatus(userId, accountId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST() {
  try {
    const { userId, accountId } = await requireRole('viewer');
    const limit = await checkRateLimit(
      `googleCalendarSync:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from('google_calendar_connections')
      .select(CONNECTION_COLUMNS)
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'Google Calendar is not connected.' },
        { status: 404 }
      );
    }
    await syncGoogleCalendar(
      admin,
      data as GoogleCalendarConnection,
      appBaseUrl()
    );
    return NextResponse.json({ data: await loadStatus(userId, accountId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const { userId, accountId } = await requireRole('viewer');
    const admin = supabaseAdmin();
    const [connection, links] = await Promise.all([
      admin
        .from('google_calendar_connections')
        .delete()
        .eq('user_id', userId)
        .eq('account_id', accountId),
      admin
        .from('google_calendar_event_links')
        .delete()
        .eq('user_id', userId)
        .eq('account_id', accountId),
    ]);
    if (connection.error) throw connection.error;
    if (links.error) throw links.error;
    return NextResponse.json({ data: await loadStatus(userId, accountId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
