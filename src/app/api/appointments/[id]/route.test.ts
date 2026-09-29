import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  existing: { id: 'appt-1', user_id: 'u1', start_time: '2026-10-01T04:30:00.000Z', status: 'scheduled', contact_id: null, contact_ids: [] } as Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  claimDeletes: [] as Array<Array<[string, unknown]>>,
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acct-1',
    supabase: {
      from: () => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          maybeSingle: async () => ({ data: state.existing, error: null }),
          update: (payload: Record<string, unknown>) => {
            state.updates.push(payload);
            return builder;
          },
          single: async () => ({ data: { ...state.existing, ...state.updates.at(-1) }, error: null }),
        };
        return builder;
      },
    },
  }),
  toErrorResponse: (err: unknown) => Response.json({ error: String(err) }, { status: 403 }),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        delete: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        in: async (column: string, values: unknown) => {
          filters.push([column, values]);
          state.claimDeletes.push([['table', table], ...filters]);
          return { error: null };
        },
      };
      return builder;
    },
  }),
}));
vi.mock('@/lib/appointments/update-notification', () => ({
  sendAppointmentUpdateNotifications: async () => ({ sent: 0, failed: 0, recipients: 0 }),
}));

import { PUT } from './route';

function put(body: Record<string, unknown>) {
  return PUT(
    new Request('http://test/api/appointments/appt-1', { method: 'PUT', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'appt-1' }) }
  );
}

describe('PUT /api/appointments/[id]', () => {
  const cronClaimsCleared = [
    ['table', 'appointment_reminder_log'],
    ['account_id', 'acct-1'],
    ['appointment_id', 'appt-1'],
    ['reminder_type', ['morning', '1h']],
  ];

  it('[CAL-010] reopening a finished or cancelled appointment re-arms its reminders and clears their claims', async () => {
    for (const status of ['completed', 'cancelled']) {
      state.existing = { ...state.existing, status };
      state.updates = [];
      state.claimDeletes = [];
      const res = await put({ status: 'scheduled' });
      expect(res.status).toBe(200);
      expect(state.updates[0]).toMatchObject({
        status: 'scheduled',
        reminder_morning_sent: false,
        reminder_1h_sent: false,
      });
      expect(state.claimDeletes).toEqual([cronClaimsCleared]);
    }
  });

  it('[CAL-010] closing an appointment, or re-sending scheduled, leaves the reminders alone', async () => {
    state.existing = { ...state.existing, status: 'scheduled' };
    for (const status of ['completed', 'cancelled', 'scheduled']) {
      state.updates = [];
      state.claimDeletes = [];
      const res = await put({ status });
      expect(res.status).toBe(200);
      expect(state.updates[0]).toMatchObject({ status });
      expect(state.updates[0]).not.toHaveProperty('reminder_morning_sent');
      expect(state.updates[0]).not.toHaveProperty('reminder_1h_sent');
      expect(state.claimDeletes).toEqual([]);
    }
  });

  it('moving an appointment to a new time re-arms its reminders and clears their claims', async () => {
    state.existing = { ...state.existing, status: 'scheduled' };
    state.updates = [];
    state.claimDeletes = [];
    const res = await put({ start_time: '2026-10-02T04:30:00.000Z' });
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({
      reminder_morning_sent: false,
      reminder_1h_sent: false,
      reschedule_requested_at: null,
      client_confirmed_at: null,
    });
    expect(state.claimDeletes).toEqual([cronClaimsCleared]);

    state.updates = [];
    state.claimDeletes = [];
    await put({ start_time: '2026-10-01T04:30:00.000Z' });
    expect(state.updates[0]).not.toHaveProperty('reminder_morning_sent');
    expect(state.claimDeletes).toEqual([]);
  });
});
