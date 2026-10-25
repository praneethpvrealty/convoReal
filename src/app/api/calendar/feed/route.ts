import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { feedUrls, generateFeedToken } from '@/lib/calendar/feed-token';
import { publicSiteUrl } from '@/lib/deals/update-delivery';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET() {
  try {
    const { userId } = await requireRole('viewer');
    const { data, error } = await supabaseAdmin()
      .from('calendar_feed_tokens')
      .select('created_at, last_used_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.error('[GET /api/calendar/feed]', error);
      return NextResponse.json(
        { error: 'Failed to load the calendar feed' },
        { status: 500 }
      );
    }
    return NextResponse.json({
      data: {
        enabled: !!data,
        created_at: data?.created_at ?? null,
        last_used_at: data?.last_used_at ?? null,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { userId, accountId } = await requireRole('viewer');
    const limit = await checkRateLimit(
      `calendarFeed:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { token, hash } = generateFeedToken();
    const { data, error } = await supabaseAdmin()
      .from('calendar_feed_tokens')
      .upsert(
        {
          user_id: userId,
          account_id: accountId,
          token_hash: hash,
          last_used_at: null,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select('created_at')
      .single();
    if (error) {
      console.error('[POST /api/calendar/feed]', error);
      return NextResponse.json(
        { error: 'Failed to create the calendar feed' },
        { status: 500 }
      );
    }

    const urls = feedUrls(publicSiteUrl(request), token);
    return NextResponse.json({
      data: {
        enabled: true,
        created_at: data.created_at,
        last_used_at: null,
        url: urls.url,
        webcal_url: urls.webcalUrl,
        google_url: urls.googleUrl,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const { userId } = await requireRole('viewer');
    const { error } = await supabaseAdmin()
      .from('calendar_feed_tokens')
      .delete()
      .eq('user_id', userId);
    if (error) {
      console.error('[DELETE /api/calendar/feed]', error);
      return NextResponse.json(
        { error: 'Failed to turn off the calendar feed' },
        { status: 500 }
      );
    }
    return NextResponse.json({ data: { enabled: false } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
