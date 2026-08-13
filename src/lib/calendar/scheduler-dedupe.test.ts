import { describe, it, expect, vi, beforeEach } from 'vitest';

const parseEventsFromInput = vi.fn();
const burnCredits = vi.fn();
const sendTextMessage = vi.fn();
const recordBotTarget = vi.fn();
const inserts: { table: string; row: Record<string, unknown> }[] = [];
const updates: { table: string; row: Record<string, unknown> }[] = [];
let tables: Record<string, Record<string, unknown>[]> = {};

vi.mock('@/lib/calendar/event-parse', async () => {
  const actual = await vi.importActual<typeof import('./event-parse')>('./event-parse');
  return { ...actual, parseEventsFromInput: (...a: unknown[]) => parseEventsFromInput(...a) };
});

vi.mock('@/lib/credits/burn', () => ({ burnCredits: (...a: unknown[]) => burnCredits(...a) }));
vi.mock('@/lib/whatsapp/bot-message-target', () => ({
  recordBotTarget: (...a: unknown[]) => recordBotTarget(...a),
}));
vi.mock('@/lib/notifications/create', () => ({ createNotification: vi.fn(async () => ({})) }));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: (...a: unknown[]) => sendTextMessage(...a),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return builder;
        },
        update: (row: Record<string, unknown>) => {
          updates.push({ table, row });
          return builder;
        },
        delete: () => builder,
        eq: () => builder,
        is: () => builder,
        or: () => builder,
        gte: () => builder,
        lt: () => builder,
        limit: () => builder,
        order: () => builder,
        single: async () => ({ data: { id: `new-${table}` }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: tables[table] ?? [], error: null }),
      });
      return builder;
    },
  }),
}));

import { tryHandleOwnerScheduling } from './whatsapp-scheduler';

const baseParams = {
  message: { id: 'm1', type: 'text' },
  contactRecord: { id: 'c1', phone: '+919876543210' },
  conversation: { id: 'conv-1' },
  accountId: 'acc',
  userId: 'user-1',
  accessToken: 'tok',
  phoneNumberId: 'pnid',
};

const draft = (over: Record<string, unknown> = {}) => ({
  intent: 'task',
  title: 'Follow up with the advocate',
  event_type: 'follow_up',
  start_time: null,
  end_time: null,
  duration_minutes: null,
  contact_name: null,
  counterparty_name: null,
  service_provider_role: null,
  property_hint: null,
  assignee_name: null,
  recipient_name: null,
  location: null,
  priority: 'medium',
  notes: null,
  transcript: null,
  day_of_week: null,
  ...over,
});

const card = () => sendTextMessage.mock.calls[0][0].text as string;

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  parseEventsFromInput.mockReset();
  burnCredits.mockReset().mockResolvedValue({ success: true });
  sendTextMessage.mockReset().mockResolvedValue({ messageId: 'wamid.card' });
  recordBotTarget.mockReset().mockResolvedValue(undefined);
  tables = { contacts: [], properties: [], liaisons: [], profiles: [], todos: [], appointments: [] };
});

describe('re-dictating a to-do', () => {
  it('updates the open one instead of filing a second', async () => {
    tables.todos = [
      {
        id: 'todo-existing',
        title: "Follow up with Kusumaraju's advocate",
        due_date: null,
        contact_id: null,
        assigned_to: 'user-1',
        user_id: 'user-1',
      },
    ];
    parseEventsFromInput.mockResolvedValue([draft()]);

    await tryHandleOwnerScheduling({ ...baseParams, contentText: 'remind me to follow up with the advocate' });

    expect(inserts.filter((i) => i.table === 'todos')).toEqual([]);
    expect(updates.filter((u) => u.table === 'todos')).toHaveLength(1);
    expect(updates[0].row.title).toBe('Follow up with the advocate');
    expect(card()).toContain('✏️ *Task updated*');
  });

  it('still files a new one when the job is different', async () => {
    tables.todos = [
      {
        id: 'todo-existing',
        title: 'Call the builder about the OC',
        due_date: null,
        assigned_to: 'user-1',
        user_id: 'user-1',
      },
    ];
    parseEventsFromInput.mockResolvedValue([draft()]);

    await tryHandleOwnerScheduling({ ...baseParams, contentText: 'remind me to follow up with the advocate' });

    expect(inserts.filter((i) => i.table === 'todos')).toHaveLength(1);
    expect(updates.filter((u) => u.table === 'todos')).toEqual([]);
    expect(card()).toContain('✅ *Task added to your list*');
  });

  it("leaves another agent's identical task alone", async () => {
    tables.todos = [
      {
        id: 'todo-theirs',
        title: 'Follow up with the advocate',
        due_date: null,
        assigned_to: 'user-2',
        user_id: 'user-2',
      },
    ];
    parseEventsFromInput.mockResolvedValue([draft()]);

    await tryHandleOwnerScheduling({ ...baseParams, contentText: 'remind me to follow up with the advocate' });

    expect(updates.filter((u) => u.table === 'todos')).toEqual([]);
    expect(inserts.filter((i) => i.table === 'todos')).toHaveLength(1);
  });

  it('points a quote-reply at the row it updated', async () => {
    tables.todos = [
      {
        id: 'todo-existing',
        title: 'Follow up with the advocate',
        due_date: null,
        assigned_to: 'user-1',
        user_id: 'user-1',
      },
    ];
    parseEventsFromInput.mockResolvedValue([draft()]);

    await tryHandleOwnerScheduling({ ...baseParams, contentText: 'remind me to follow up with the advocate' });

    expect(recordBotTarget).toHaveBeenCalledTimes(1);
    expect(recordBotTarget.mock.calls[0][0]).toMatchObject({
      entityType: 'todo',
      entityId: 'todo-existing',
    });
  });
});

describe('re-dictating an appointment', () => {
  const scheduled = (over: Record<string, unknown> = {}) => ({
    id: 'appt-existing',
    title: 'Meeting with the advocate',
    start_time: '2026-08-17T04:30:00.000Z',
    contact_id: null,
    liaison_id: null,
    assigned_to: 'user-1',
    user_id: 'user-1',
    ...over,
  });

  it('corrects the one already on that day', async () => {
    tables.appointments = [scheduled()];
    parseEventsFromInput.mockResolvedValue([
      draft({ intent: 'schedule', title: 'Meeting with the advocate', start_time: '2026-08-17T16:00' }),
    ]);

    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'meeting with the advocate on Monday 4pm',
    });

    expect(inserts.filter((i) => i.table === 'appointments')).toEqual([]);
    const applied = updates.filter((u) => u.table === 'appointments');
    expect(applied).toHaveLength(1);
    // The restated time replaces the one already there.
    expect(applied[0].row.start_time).toBe('2026-08-17T10:30:00.000Z');
    expect(card()).toContain('✏️ *Updated on your calendar*');
  });

  it('keeps the same meeting on another day as its own event', async () => {
    tables.appointments = [scheduled({ start_time: '2026-08-21T04:30:00.000Z' })];
    parseEventsFromInput.mockResolvedValue([
      draft({ intent: 'schedule', title: 'Meeting with the advocate', start_time: '2026-08-17T16:00' }),
    ]);

    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'meeting with the advocate on Monday 4pm',
    });

    expect(inserts.filter((i) => i.table === 'appointments')).toHaveLength(1);
    expect(updates.filter((u) => u.table === 'appointments')).toEqual([]);
    expect(card()).toContain('✅ *Added to your calendar*');
  });
});
