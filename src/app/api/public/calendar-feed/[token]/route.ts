import { NextResponse } from 'next/server';

import { hashFeedToken } from '@/lib/calendar/feed-token';
import {
  buildIcsCalendar,
  feedTokenFromParam,
  type IcsEvent,
} from '@/lib/calendar/ics-feed';
import {
  activeMemberAccountName,
  loadMemberCalendarEvents,
} from '@/lib/calendar/member-events';
import { clientIp } from '@/lib/deals/share-server';
import { publicSiteUrl } from '@/lib/deals/update-delivery';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

const LAST_USED_THROTTLE_MS = 15 * 60_000;

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const ipLimit = await checkRateLimit(
    `calendarFeedIp:${clientIp(request)}`,
    RATE_LIMITS.publicCalendarFeedIp
  );
  if (!ipLimit.success) return rateLimitResponse(ipLimit);

  const token = feedTokenFromParam((await params).token);
  if (!token) return notFound();
  const hash = hashFeedToken(token);

  const tokenLimit = await checkRateLimit(
    `calendarFeed:${hash}`,
    RATE_LIMITS.publicCalendarFeed
  );
  if (!tokenLimit.success) return rateLimitResponse(tokenLimit);

  const admin = supabaseAdmin();
  const { data: feed, error: feedError } = await admin
    .from('calendar_feed_tokens')
    .select('id, account_id, user_id, last_used_at')
    .eq('token_hash', hash)
    .maybeSingle();
  if (feedError) {
    console.error('[calendar-feed] token lookup failed:', feedError);
    return NextResponse.json({ error: 'Feed unavailable' }, { status: 500 });
  }
  if (!feed) return notFound();

  const now = new Date();
  let accountName: string | null;
  let events: IcsEvent[];
  try {
    accountName = await activeMemberAccountName(
      admin,
      feed.account_id,
      feed.user_id
    );
    if (!accountName) return notFound();
    events = await loadMemberCalendarEvents(
      admin,
      feed.account_id,
      feed.user_id,
      publicSiteUrl(request).replace(/\/+$/, ''),
      now
    );
  } catch (error) {
    console.error('[calendar-feed] load failed:', error);
    return NextResponse.json({ error: 'Feed unavailable' }, { status: 500 });
  }

  if (
    !feed.last_used_at ||
    now.getTime() - new Date(feed.last_used_at).getTime() >
      LAST_USED_THROTTLE_MS
  ) {
    const { error: touchError } = await admin
      .from('calendar_feed_tokens')
      .update({ last_used_at: now.toISOString() })
      .eq('id', feed.id)
      .eq('token_hash', hash);
    if (touchError) {
      console.error('[calendar-feed] last_used_at update failed:', touchError);
    }
  }

  return new NextResponse(
    buildIcsCalendar(`ConvoReal · ${accountName}`, events, now),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="convoreal.ics"',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      },
    }
  );
}
