import type { SupabaseClient } from '@supabase/supabase-js';

import { feedWindow } from '@/lib/calendar/ics-feed';
import {
  activeMemberAccountName,
  loadMemberCalendarEvents,
} from '@/lib/calendar/member-events';
import {
  createCalendar,
  deleteEvent,
  insertEvent,
  isGoneError,
  updateEvent,
} from '@/lib/google-calendar/client';
import {
  SYNC_MAX_OPERATIONS,
  planSync,
  toDesiredEvent,
  type EventLink,
} from '@/lib/google-calendar/plan';
import { decrypt } from '@/lib/whatsapp/encryption';
import { isAuthError, refreshAccessToken } from '@/lib/youtube/client';

export interface GoogleCalendarConnection {
  id: string;
  account_id: string;
  user_id: string;
  refresh_token: string;
  calendar_id: string | null;
}

export interface SyncResult {
  status: 'synced' | 'token_expired' | 'not_member' | 'error';
  created: number;
  updated: number;
  removed: number;
  error?: string;
}

export const CONNECTION_COLUMNS =
  'id, account_id, user_id, refresh_token, calendar_id';

function googleCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth is not configured on this server.');
  }
  return { clientId, clientSecret };
}

async function markConnection(
  admin: SupabaseClient,
  connection: GoogleCalendarConnection,
  fields: Record<string, unknown>
) {
  const { error } = await admin
    .from('google_calendar_connections')
    .update(fields)
    .eq('id', connection.id)
    .eq('account_id', connection.account_id);
  if (error) console.error('[google-calendar] status update failed:', error);
}

export async function syncGoogleCalendar(
  admin: SupabaseClient,
  connection: GoogleCalendarConnection,
  appUrl: string,
  now: Date = new Date()
): Promise<SyncResult> {
  const result: SyncResult = {
    status: 'synced',
    created: 0,
    updated: 0,
    removed: 0,
  };
  const scope = {
    account_id: connection.account_id,
    user_id: connection.user_id,
  };

  try {
    const member = await activeMemberAccountName(
      admin,
      connection.account_id,
      connection.user_id
    );
    if (!member) {
      await markConnection(admin, connection, {
        status: 'error',
        last_error: 'You are no longer a member of this workspace.',
      });
      return { ...result, status: 'not_member' };
    }

    let accessToken: string;
    try {
      const tokens = await refreshAccessToken({
        refreshToken: decrypt(connection.refresh_token),
        ...googleCredentials(),
      });
      accessToken = tokens.access_token;
    } catch (err) {
      if (!isAuthError(err)) throw err;
      await markConnection(admin, connection, {
        status: 'token_expired',
        last_error: 'Google access was revoked. Reconnect to resume syncing.',
      });
      return { ...result, status: 'token_expired' };
    }

    let calendarId = connection.calendar_id;
    if (!calendarId) {
      calendarId = await createCalendar(accessToken);
      const { error: deleteLinksError } = await admin
        .from('google_calendar_event_links')
        .delete()
        .match(scope);
      if (deleteLinksError) throw deleteLinksError;
      await markConnection(admin, connection, { calendar_id: calendarId });
    }

    const events = await loadMemberCalendarEvents(
      admin,
      connection.account_id,
      connection.user_id,
      appUrl,
      now
    );
    const desired = events.map(toDesiredEvent);

    const { data: linkRows, error: linksError } = await admin
      .from('google_calendar_event_links')
      .select('source_uid, google_event_id, content_hash, starts_at')
      .match(scope);
    if (linksError) throw linksError;
    const links = (linkRows ?? []) as EventLink[];

    const { from } = feedWindow(now);
    const plan = planSync(desired, links, from);

    const writeLink = async (
      uid: string,
      eventId: string,
      hash: string,
      startsAt: string
    ) => {
      const { error } = await admin.from('google_calendar_event_links').upsert(
        {
          ...scope,
          source_uid: uid,
          google_event_id: eventId,
          content_hash: hash,
          starts_at: startsAt,
        },
        { onConflict: 'user_id,source_uid' }
      );
      if (error) throw error;
    };

    for (const link of plan.remove) {
      await deleteEvent(accessToken, calendarId, link.google_event_id);
      const { error } = await admin
        .from('google_calendar_event_links')
        .delete()
        .match({ ...scope, source_uid: link.source_uid });
      if (error) throw error;
      result.removed += 1;
    }

    for (const event of plan.create) {
      const eventId = await insertEvent(accessToken, calendarId, event.body);
      await writeLink(event.uid, eventId, event.hash, event.startsAt);
      result.created += 1;
    }

    for (const { desired: event, link } of plan.update) {
      try {
        await updateEvent(
          accessToken,
          calendarId,
          link.google_event_id,
          event.body
        );
        await writeLink(
          event.uid,
          link.google_event_id,
          event.hash,
          event.startsAt
        );
        result.updated += 1;
      } catch (err) {
        if (!isGoneError(err)) throw err;
        const eventId = await insertEvent(accessToken, calendarId, event.body);
        await writeLink(event.uid, eventId, event.hash, event.startsAt);
        result.created += 1;
      }
    }

    const operations =
      plan.create.length + plan.update.length + plan.remove.length;
    if (operations < SYNC_MAX_OPERATIONS) {
      const { error: pruneError } = await admin
        .from('google_calendar_event_links')
        .delete()
        .match(scope)
        .lt('starts_at', from.toISOString());
      if (pruneError) throw pruneError;
    }

    await markConnection(admin, connection, {
      status: 'connected',
      last_error: null,
      last_synced_at: now.toISOString(),
    });
    return result;
  } catch (err) {
    if (isGoneError(err) && connection.calendar_id) {
      await markConnection(admin, connection, {
        calendar_id: null,
        status: 'error',
        last_error:
          'The ConvoReal calendar was removed from Google. It is recreated on the next sync.',
      });
    } else {
      await markConnection(admin, connection, {
        status: 'error',
        last_error: err instanceof Error ? err.message : 'Sync failed',
      });
    }
    console.error('[google-calendar] sync failed:', err);
    return {
      ...result,
      status: 'error',
      error: err instanceof Error ? err.message : 'Sync failed',
    };
  }
}
