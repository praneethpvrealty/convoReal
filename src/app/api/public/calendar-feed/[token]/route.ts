import { NextResponse } from 'next/server';

import { hashFeedToken } from '@/lib/calendar/feed-token';
import {
  FEED_MAX_ITEMS,
  appointmentToIcsEvent,
  buildIcsCalendar,
  feedTokenFromParam,
  feedWindow,
  todoToIcsEvent,
  type FeedAppointment,
  type FeedTodo,
  type IcsEvent,
} from '@/lib/calendar/ics-feed';
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

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('account_id, account:accounts!inner(name, status)')
    .eq('user_id', feed.user_id)
    .eq('account_id', feed.account_id)
    .maybeSingle();
  if (profileError) {
    console.error('[calendar-feed] profile lookup failed:', profileError);
    return NextResponse.json({ error: 'Feed unavailable' }, { status: 500 });
  }
  const account = Array.isArray(profile?.account)
    ? profile.account[0]
    : profile?.account;
  if (!profile || !account || account.status === 'archived') {
    return notFound();
  }

  const now = new Date();
  const { from, to } = feedWindow(now);
  const ownedBy = `assigned_to.eq.${feed.user_id},and(assigned_to.is.null,user_id.eq.${feed.user_id})`;

  const [appointments, todos] = await Promise.all([
    admin
      .from('appointments')
      .select(
        'id, title, description, agenda, start_time, end_time, location, event_type, updated_at, ' +
          'contact:contacts(name, phone), property:properties(title)'
      )
      .eq('account_id', feed.account_id)
      .or(ownedBy)
      .neq('status', 'cancelled')
      .gte('start_time', from.toISOString())
      .lte('start_time', to.toISOString())
      .order('start_time', { ascending: true })
      .limit(FEED_MAX_ITEMS),
    admin
      .from('todos')
      .select(
        'id, title, description, due_date, priority, updated_at, ' +
          'contact:contacts(name, phone), property:properties(title)'
      )
      .eq('account_id', feed.account_id)
      .or(ownedBy)
      .eq('completed', false)
      .gte('due_date', from.toISOString())
      .lte('due_date', to.toISOString())
      .order('due_date', { ascending: true })
      .limit(FEED_MAX_ITEMS),
  ]);
  if (appointments.error || todos.error) {
    console.error(
      '[calendar-feed] load failed:',
      appointments.error ?? todos.error
    );
    return NextResponse.json({ error: 'Feed unavailable' }, { status: 500 });
  }

  const appUrl = publicSiteUrl(request).replace(/\/+$/, '');
  const events = [
    ...(appointments.data as unknown as FeedAppointment[]).map((a) =>
      appointmentToIcsEvent(a, appUrl)
    ),
    ...(todos.data as unknown as FeedTodo[]).map((t) =>
      todoToIcsEvent(t, appUrl)
    ),
  ].filter((event): event is IcsEvent => event !== null);

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
    buildIcsCalendar(`ConvoReal · ${account.name}`, events, now),
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
