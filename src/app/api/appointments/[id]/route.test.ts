import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  existing: { id: 'appt-1', user_id: 'u1', start_time: '2026-10-01T04:30:00.000Z', status: 'scheduled', contact_id: null, contact_ids: [] } as Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
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

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({}) }));
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
  const rearmed = (update: Record<string, unknown>) => {
    expect(update).toMatchObject({
      reminder_morning_sent: false,
      reminder_1h_sent: false,
    });
    expect(typeof update.reminders_rearmed_at).toBe('string');
    expect(Number.isNaN(Date.parse(String(update.reminders_rearmed_at)))).toBe(false);
  };
  const untouched = (update: Record<string, unknown>) => {
    expect(update).not.toHaveProperty('reminder_morning_sent');
    expect(update).not.toHaveProperty('reminder_1h_sent');
    expect(update).not.toHaveProperty('reminders_rearmed_at');
  };

  it('[CAL-010] reopening a finished or cancelled appointment re-arms its reminders in the same write', async () => {
    for (const status of ['completed', 'cancelled']) {
      state.existing = { ...state.existing, status };
      state.updates = [];
      const res = await put({ status: 'scheduled' });
      expect(res.status).toBe(200);
      expect(state.updates).toHaveLength(1);
      expect(state.updates[0]).toMatchObject({ status: 'scheduled' });
      rearmed(state.updates[0]);
    }
  });

  it('[CAL-010] closing an appointment, or re-sending scheduled, leaves the reminders alone', async () => {
    state.existing = { ...state.existing, status: 'scheduled' };
    for (const status of ['completed', 'cancelled', 'scheduled']) {
      state.updates = [];
      const res = await put({ status });
      expect(res.status).toBe(200);
      expect(state.updates[0]).toMatchObject({ status });
      untouched(state.updates[0]);
    }
  });

  it('moving an appointment to a new time re-arms its reminders the same way', async () => {
    state.existing = { ...state.existing, status: 'scheduled' };
    state.updates = [];
    const res = await put({ start_time: '2026-10-02T04:30:00.000Z' });
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({
      reschedule_requested_at: null,
      client_confirmed_at: null,
    });
    rearmed(state.updates[0]);

    state.updates = [];
    await put({ start_time: '2026-10-01T04:30:00.000Z' });
    untouched(state.updates[0]);
  });
});
