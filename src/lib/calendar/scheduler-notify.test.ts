import { describe, it, expect, vi, beforeEach } from 'vitest';

const parseEventsFromInput = vi.fn();
const burnCredits = vi.fn();
const sendTextMessage = vi.fn();
const createNotification = vi.fn();
const recordBotTarget = vi.fn();
const inserts: { table: string; row: Record<string, unknown> }[] = [];
let tables: Record<string, Record<string, unknown>[]> = {};
/** Tables whose insert should come back as a write error. */
let failInserts = new Set<string>();

vi.mock('@/lib/calendar/event-parse', async () => {
  const actual =
    await vi.importActual<typeof import('./event-parse')>('./event-parse');
  return {
    ...actual,
    parseEventsFromInput: (...a: unknown[]) => parseEventsFromInput(...a),
  };
});

vi.mock('@/lib/credits/burn', () => ({
  burnCredits: (...a: unknown[]) => burnCredits(...a),
}));
vi.mock('@/lib/whatsapp/bot-message-target', () => ({
  recordBotTarget: (...a: unknown[]) => recordBotTarget(...a),
}));
vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...a: unknown[]) => createNotification(...a),
}));
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
        update: () => builder,
        delete: () => builder,
        eq: () => builder,
        or: () => builder,
        gte: () => builder,
        lt: () => builder,
        limit: () => builder,
        is: () => builder,
        order: () => builder,
        single: async () =>
          failInserts.has(table)
            ? { data: null, error: { message: 'insert failed' } }
            : { data: { id: `new-${table}` }, error: null },
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

const notify = (over: Record<string, unknown> = {}) => ({
  intent: 'notify',
  title: 'Kusumaraju meeting outcome',
  event_type: 'other',
  start_time: null,
  end_time: null,
  duration_minutes: null,
  contact_name: null,
  counterparty_name: null,
  service_provider_role: null,
  property_hint: null,
  assignee_name: null,
  recipient_name: 'Sharan',
  location: null,
  priority: 'medium',
  notes: 'Advocate is away for a week.',
  transcript: null,
  day_of_week: null,
  ...over,
});

const task = (over: Record<string, unknown> = {}) => ({
  ...notify(),
  intent: 'task',
  title: "Follow up with Kusumaraju's advocate",
  recipient_name: null,
  notes: null,
  ...over,
});

const card = () => sendTextMessage.mock.calls[0][0].text as string;

beforeEach(() => {
  inserts.length = 0;
  failInserts = new Set();
  parseEventsFromInput.mockReset();
  burnCredits.mockReset().mockResolvedValue({ success: true });
  sendTextMessage.mockReset().mockResolvedValue({ messageId: 'wamid.card' });
  recordBotTarget.mockReset().mockResolvedValue(undefined);
  createNotification
    .mockReset()
    .mockResolvedValue({
      inAppId: 'notif-1',
      whatsapp: { success: true },
      pushCount: 1,
    });
  tables = {
    contacts: [],
    properties: [],
    liaisons: [],
    profiles: [
      { user_id: 'user-1', full_name: 'Praneeth' },
      { user_id: 'user-2', full_name: 'Sharan' },
    ],
  };
});

describe('notify intent', () => {
  it('sends the update to the named teammate instead of filing a task', async () => {
    parseEventsFromInput.mockResolvedValue([notify()]);

    const handled = await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'Send Sharan the update on the Kusumaraju meeting',
    });

    expect(handled).toBe(true);
    expect(
      inserts.filter((i) => i.table === 'todos' || i.table === 'appointments')
    ).toEqual([]);
    expect(createNotification).toHaveBeenCalledTimes(1);

    const sent = createNotification.mock.calls[0][0];
    expect(sent.userId).toBe('user-2');
    expect(sent.accountId).toBe('acc');
    expect(sent.eventKey).toBe('teammate_update');
    expect(sent.title).toBe('Update from Praneeth');
    expect(sent.whatsappText).toContain('Kusumaraju meeting outcome');
    expect(sent.whatsappText).toContain('Advocate is away for a week.');
  });

  it('tells the sender it went out', async () => {
    parseEventsFromInput.mockResolvedValue([notify()]);
    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'let sharan know the outcome',
    });

    expect(card()).toContain('📨 *Update sent to Sharan*');
    expect(card()).toContain('Kusumaraju meeting outcome');
  });

  it('reports a name that is not on the team rather than guessing', async () => {
    parseEventsFromInput.mockResolvedValue([
      notify({ recipient_name: 'Sharath' }),
    ]);
    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'let sharath know the outcome',
    });

    expect(createNotification).not.toHaveBeenCalled();
    expect(card()).toContain("Couldn't send that update");
    expect(card()).toContain('Sharath');
  });

  it('refuses to ping the sender back with their own update', async () => {
    parseEventsFromInput.mockResolvedValue([
      notify({ recipient_name: 'Praneeth' }),
    ]);
    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'let praneeth know the outcome',
    });

    expect(createNotification).not.toHaveBeenCalled();
    expect(card()).toContain("Couldn't send that update");
  });

  it('says so when WhatsApp refused but the app got it', async () => {
    createNotification.mockResolvedValue({
      inAppId: 'notif-1',
      whatsapp: { success: false },
      pushCount: 0,
    });
    parseEventsFromInput.mockResolvedValue([notify()]);
    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'let sharan know the outcome',
    });

    expect(card()).toContain('📨 *Update sent to Sharan*');
    expect(card()).toContain("WhatsApp couldn't reach them");
  });

  it('reports a delivery that reached nobody', async () => {
    createNotification.mockResolvedValue({
      inAppId: null,
      whatsapp: null,
      pushCount: 0,
    });
    parseEventsFromInput.mockResolvedValue([notify()]);
    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'let sharan know the outcome',
    });

    expect(card()).toContain("Couldn't deliver that update to Sharan");
  });
});

describe('multiple requests from one message', () => {
  it('files every request and reports them in one card', async () => {
    parseEventsFromInput.mockResolvedValue([
      notify(),
      task({ start_time: '2026-08-20T10:00' }),
    ]);

    const handled = await tryHandleOwnerScheduling({
      ...baseParams,
      contentText:
        "Send Sharan the update on the Kusumaraju meeting. The advocate isn't available for a week, so remind me to follow up after that",
    });

    expect(handled).toBe(true);
    expect(createNotification).toHaveBeenCalledTimes(1);

    const todos = inserts.filter((i) => i.table === 'todos');
    expect(todos).toHaveLength(1);
    expect(todos[0].row.title).toBe("Follow up with Kusumaraju's advocate");

    expect(card()).toContain('📨 *Update sent to Sharan*');
    expect(card()).toContain('✅ *Task added to your list*');
    // One footer, at the end, however many requests the message carried.
    expect(card().match(/Reply \*today\*/g)).toHaveLength(1);
    expect(card().trimEnd().endsWith("day's schedule._")).toBe(true);
  });

  it('leaves a single request card exactly as it was', async () => {
    parseEventsFromInput.mockResolvedValue([task({ start_time: null })]);
    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'remind me to follow up',
    });

    expect(card()).toBe(
      [
        '✅ *Task added to your list*',
        "📝 Follow up with Kusumaraju's advocate",
        '',
        "_Reply *today* anytime to see your day's schedule._",
      ].join('\n')
    );
  });

  it('registers a quote-reply target only when one row was created', async () => {
    parseEventsFromInput.mockResolvedValue([task()]);
    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'remind me to follow up',
    });
    expect(recordBotTarget).toHaveBeenCalledTimes(1);

    recordBotTarget.mockClear();
    parseEventsFromInput.mockResolvedValue([
      task(),
      task({ title: 'Second job' }),
    ]);
    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'remind me to follow up twice',
    });
    expect(recordBotTarget).not.toHaveBeenCalled();
  });

  it('keeps filing the rest when one request fails to save', async () => {
    // Losing the second job because the first one's insert failed is how a
    // dictated pair of instructions half-disappears.
    failInserts.add('todos');
    parseEventsFromInput.mockResolvedValue([task(), notify()]);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handled = await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'remind me, and tell sharan',
    });

    expect(handled).toBe(true);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(card()).toContain("Couldn't save that task");
    expect(card()).toContain('📨 *Update sent to Sharan*');
    expect(recordBotTarget).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
