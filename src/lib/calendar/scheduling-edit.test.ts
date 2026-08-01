import { describe, it, expect, vi, beforeEach } from 'vitest';

const parseEventUpdate = vi.fn();
const burnCredits = vi.fn();
const sendTextMessage = vi.fn();
const updates: { table: string; patch: Record<string, unknown> }[] = [];
let rowByTable: Record<string, Record<string, unknown> | null> = {};

vi.mock('@/lib/calendar/event-parse', async () => {
  const actual = await vi.importActual<typeof import('./event-parse')>('./event-parse');
  return { ...actual, parseEventUpdate: (...a: unknown[]) => parseEventUpdate(...a) };
});

vi.mock('@/lib/credits/burn', () => ({ burnCredits: (...a: unknown[]) => burnCredits(...a) }));

vi.mock('@/lib/whatsapp/bot-message-target', () => ({ recordBotTarget: vi.fn(async () => {}) }));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: (...a: unknown[]) => sendTextMessage(...a),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}));

vi.mock('@/lib/notifications/create', () => ({ createNotification: vi.fn(async () => {}) }));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      let pendingPatch: Record<string, unknown> | null = null;
      Object.assign(builder, {
        select: () => builder,
        insert: () => builder,
        update: (patch: Record<string, unknown>) => {
          pendingPatch = patch;
          updates.push({ table, patch });
          return builder;
        },
        eq: () => builder,
        maybeSingle: async () => ({ data: rowByTable[table] ?? null, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({ data: pendingPatch ? null : [], error: null }),
      });
      return builder;
    },
  }),
}));

import { applySchedulingEdit } from './whatsapp-scheduler';

const NOW = new Date('2026-08-01T08:00:00Z');

const params = {
  target: { entityType: 'appointment' as const, entityId: 'appt-1' },
  instruction: 'Change this to Monday 5pm',
  contactRecord: { id: 'c1', phone: '+919876543210' },
  conversation: { id: 'conv-1' },
  accountId: 'acc',
  userId: 'user',
  accessToken: 'tok',
  phoneNumberId: 'pnid',
  now: NOW,
};

const appointment = (over: Record<string, unknown> = {}) => ({
  id: 'appt-1',
  title: 'Meeting with Kusuma lawyer',
  event_type: 'meeting',
  status: 'scheduled',
  start_time: '2026-08-04T11:30:00.000Z',
  end_time: '2026-08-04T12:30:00.000Z',
  location: null,
  agenda: null,
  ...over,
});

beforeEach(() => {
  updates.length = 0;
  parseEventUpdate.mockReset();
  burnCredits.mockReset().mockResolvedValue({ success: true });
  sendTextMessage.mockReset().mockResolvedValue({ messageId: 'wamid.reply' });
  rowByTable = { appointments: appointment(), profiles: null };
  parseEventUpdate.mockResolvedValue({
    intent: 'schedule',
    title: 'Meeting with KusumamuniRaju lawyer',
    event_type: 'meeting',
    start_time: '2026-08-03T17:00',
    end_time: null,
    duration_minutes: null,
    location: null,
    priority: 'medium',
    day_of_week: 'monday',
  });
});

describe('applySchedulingEdit', () => {
  it('updates the quoted event instead of creating a second one', async () => {
    const outcome = await applySchedulingEdit(params);

    expect(outcome).toBe('edited');
    const patch = updates.find((u) => u.table === 'appointments')!.patch;
    expect(patch.title).toBe('Meeting with KusumamuniRaju lawyer');
    expect(patch.start_time).toBe('2026-08-03T11:30:00.000Z');
  });

  it('re-arms the reminders when the time moves', async () => {
    await applySchedulingEdit(params);

    const patch = updates.find((u) => u.table === 'appointments')!.patch;
    expect(patch).toMatchObject({
      reminder_morning_sent: false,
      reminder_1h_sent: false,
      agent_reminder_sent: false,
    });
  });

  it('tells the user it was an update, not an add', async () => {
    await applySchedulingEdit(params);
    const sent = sendTextMessage.mock.calls[0][0].text as string;
    expect(sent).toContain('Updated on your calendar');
    expect(sent).not.toContain('Added to your calendar');
  });

  it('reports a finished event as stale rather than rewriting history', async () => {
    rowByTable.appointments = appointment({
      start_time: '2026-07-20T11:30:00.000Z',
      end_time: '2026-07-20T12:30:00.000Z',
    });
    expect(await applySchedulingEdit(params)).toBe('stale');
    expect(updates).toHaveLength(0);
  });

  it('reports a cancelled event as stale', async () => {
    rowByTable.appointments = appointment({ status: 'cancelled' });
    expect(await applySchedulingEdit(params)).toBe('stale');
    expect(updates).toHaveLength(0);
  });

  it('reports a deleted event as stale', async () => {
    rowByTable.appointments = null;
    expect(await applySchedulingEdit(params)).toBe('stale');
    expect(updates).toHaveLength(0);
  });

  it('spends nothing when the target is stale', async () => {
    rowByTable.appointments = appointment({ status: 'completed' });
    await applySchedulingEdit(params);
    expect(burnCredits).not.toHaveBeenCalled();
    expect(parseEventUpdate).not.toHaveBeenCalled();
  });

  it('skips without touching the row when the reply is not a correction', async () => {
    parseEventUpdate.mockResolvedValue({ intent: 'none', title: 'x', event_type: 'other' });
    expect(await applySchedulingEdit(params)).toBe('skipped');
    expect(updates).toHaveLength(0);
  });
});
