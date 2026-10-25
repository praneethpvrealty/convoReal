import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  isAuthError: vi.fn(),
  createCalendar: vi.fn(),
  insertEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  activeMemberAccountName: vi.fn(),
  loadMemberCalendarEvents: vi.fn(),
}));

vi.mock('@/lib/youtube/client', () => ({
  refreshAccessToken: mocks.refreshAccessToken,
  isAuthError: mocks.isAuthError,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => `plain:${value}`,
}));
vi.mock('@/lib/calendar/member-events', () => ({
  activeMemberAccountName: mocks.activeMemberAccountName,
  loadMemberCalendarEvents: mocks.loadMemberCalendarEvents,
}));
vi.mock('@/lib/google-calendar/client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/google-calendar/client')>();
  return {
    ...actual,
    createCalendar: mocks.createCalendar,
    insertEvent: mocks.insertEvent,
    updateEvent: mocks.updateEvent,
    deleteEvent: mocks.deleteEvent,
  };
});

import { GoogleCalendarApiError } from '@/lib/google-calendar/client';

import { syncGoogleCalendar, type GoogleCalendarConnection } from './sync';

interface Op {
  table: string;
  action: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
}

function fakeAdmin(links: unknown[] = []) {
  const ops: Op[] = [];
  const admin = {
    from(table: string) {
      const op: Op = { table, action: 'select', filters: [] };
      ops.push(op);
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (payload: unknown) => {
          op.action = 'update';
          op.payload = payload;
          return builder;
        },
        upsert: (payload: unknown) => {
          op.action = 'upsert';
          op.payload = payload;
          return builder;
        },
        delete: () => {
          op.action = 'delete';
          return builder;
        },
        eq: (column: string, value: unknown) => {
          op.filters.push([column, value]);
          return builder;
        },
        match: (value: unknown) => {
          op.filters.push(['match', value]);
          return builder;
        },
        lt: (column: string, value: unknown) => {
          op.filters.push([`lt:${column}`, value]);
          return builder;
        },
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data: op.action === 'select' ? links : null,
            error: null,
          }),
      };
      return builder;
    },
  };
  return { admin, ops };
}

const connection: GoogleCalendarConnection = {
  id: 'conn-1',
  account_id: 'acct-1',
  user_id: 'user-1',
  refresh_token: 'enc',
  calendar_id: 'cal-1',
};

const event = {
  uid: 'appointment-a@convoreal',
  summary: 'Site visit',
  start: new Date('2026-11-01T10:30:00Z'),
  end: new Date('2026-11-01T11:00:00Z'),
};

beforeEach(() => {
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client');
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'secret');
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.activeMemberAccountName.mockResolvedValue('Acme');
  mocks.refreshAccessToken.mockResolvedValue({ access_token: 'at' });
  mocks.isAuthError.mockReturnValue(false);
  mocks.loadMemberCalendarEvents.mockResolvedValue([event]);
  mocks.insertEvent.mockResolvedValue('g-1');
});

describe('[CAL-015] syncGoogleCalendar', () => {
  it('[CAL-015] adds a new item and records its link under the member and account', async () => {
    const { admin, ops } = fakeAdmin();
    const result = await syncGoogleCalendar(
      admin as never,
      connection,
      'https://app.test',
      new Date('2026-10-25T00:00:00Z')
    );
    expect(result).toMatchObject({ status: 'synced', created: 1 });
    expect(mocks.refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'plain:enc' })
    );
    expect(mocks.insertEvent).toHaveBeenCalledWith(
      'at',
      'cal-1',
      expect.objectContaining({ summary: 'Site visit' })
    );
    const upsert = ops.find((op) => op.action === 'upsert');
    expect(upsert?.payload).toMatchObject({
      account_id: 'acct-1',
      user_id: 'user-1',
      source_uid: event.uid,
      google_event_id: 'g-1',
    });
    const done = ops.filter(
      (op) =>
        op.table === 'google_calendar_connections' && op.action === 'update'
    );
    expect(done.at(-1)?.payload).toMatchObject({ status: 'connected' });
    expect(done.at(-1)?.filters).toContainEqual(['account_id', 'acct-1']);
  });

  it('[CAL-015] stops and asks for a reconnect when Google revoked access', async () => {
    mocks.refreshAccessToken.mockRejectedValue(new Error('invalid_grant'));
    mocks.isAuthError.mockReturnValue(true);
    const { admin, ops } = fakeAdmin();
    const result = await syncGoogleCalendar(admin as never, connection, 'x');
    expect(result.status).toBe('token_expired');
    expect(mocks.insertEvent).not.toHaveBeenCalled();
    expect(ops.at(-1)?.payload).toMatchObject({ status: 'token_expired' });
  });

  it('[CAL-015] stops for a member who left the workspace', async () => {
    mocks.activeMemberAccountName.mockResolvedValue(null);
    const { admin } = fakeAdmin();
    const result = await syncGoogleCalendar(admin as never, connection, 'x');
    expect(result.status).toBe('not_member');
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('[CAL-015] forgets a calendar the member deleted in Google so the next run recreates it', async () => {
    mocks.insertEvent.mockRejectedValue(
      new GoogleCalendarApiError('Not Found', 404)
    );
    const { admin, ops } = fakeAdmin();
    const result = await syncGoogleCalendar(admin as never, connection, 'x');
    expect(result.status).toBe('error');
    expect(ops.at(-1)?.payload).toMatchObject({ calendar_id: null });
  });
});
