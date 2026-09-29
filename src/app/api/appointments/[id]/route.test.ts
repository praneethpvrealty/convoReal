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
  it('[CAL-010] reopening a finished or cancelled appointment re-arms its reminders', async () => {
    for (const status of ['completed', 'cancelled']) {
      state.existing = { ...state.existing, status };
      state.updates = [];
      const res = await put({ status: 'scheduled' });
      expect(res.status).toBe(200);
      expect(state.updates[0]).toMatchObject({
        status: 'scheduled',
        reminder_morning_sent: false,
        reminder_1h_sent: false,
      });
    }
  });

  it('[CAL-010] closing an appointment, or re-sending scheduled, leaves the reminder flags alone', async () => {
    state.existing = { ...state.existing, status: 'scheduled' };
    for (const status of ['completed', 'cancelled', 'scheduled']) {
      state.updates = [];
      const res = await put({ status });
      expect(res.status).toBe(200);
      expect(state.updates[0]).toMatchObject({ status });
      expect(state.updates[0]).not.toHaveProperty('reminder_morning_sent');
      expect(state.updates[0]).not.toHaveProperty('reminder_1h_sent');
    }
  });
});
