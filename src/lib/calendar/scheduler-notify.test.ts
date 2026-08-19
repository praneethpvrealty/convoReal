import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCallUpdateTemplatePayload } from '@/lib/whatsapp/call-update-template';

const parseEventsFromInput = vi.fn();
const burnCredits = vi.fn();
const sendTextMessage = vi.fn();
const createNotification = vi.fn();
const recordBotTarget = vi.fn();
const sendWhatsAppMessageAndPersist = vi.fn();
const loadTemplateForContact = vi.fn();
const warnLanguageFallback = vi.fn();
const canSendToEveryLead = vi.fn();
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
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...a: unknown[]) => sendWhatsAppMessageAndPersist(...a),
}));
vi.mock('@/lib/whatsapp/template-language', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/whatsapp/template-language')
  >('@/lib/whatsapp/template-language');
  return {
    ...actual,
    loadTemplateForContact: (...a: unknown[]) => loadTemplateForContact(...a),
    warnLanguageFallback: (...a: unknown[]) => warnLanguageFallback(...a),
  };
});
vi.mock('@/lib/reengagement/template-gate', () => ({
  canSendToEveryLead: (...a: unknown[]) => canSendToEveryLead(...a),
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
  sendWhatsAppMessageAndPersist.mockReset().mockResolvedValue({ success: true });
  loadTemplateForContact.mockReset().mockResolvedValue({
    template: null,
    language: 'en_US',
    fellBack: false,
  });
  warnLanguageFallback.mockReset();
  canSendToEveryLead.mockReset().mockReturnValue(true);
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

  it.each([
    'Can you update C Kumar about this?',
    'Can you inform C Kumar about this update?',
    'Can you inform C Kumar about this update to the client?',
  ])('sends a contact update for phrase "%s"', async (contentText) => {
    tables.contacts = [{ id: 'contact-c-kumar', name: 'C Kumar', phone: '+919999999999' }];
    parseEventsFromInput.mockResolvedValue([
      notify({
        recipient_name: 'C Kumar',
        title: 'Update for C Kumar',
        notes: 'Suleiman client has approved the 9,600 sqft Jayanagar plot',
      }),
    ]);

    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText,
    });

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc',
        userId: 'user-1',
        contactId: 'contact-c-kumar',
        conversationId: 'conv-1',
        kind: 'text',
        senderType: 'agent',
      })
    );
    expect(card()).toContain('📨 *Update sent to C Kumar*');
    expect(card()).toContain('Update for C Kumar');
  });

  it('sends a client notify through WhatsApp instead of filing a task', async () => {
    tables.contacts = [
      {
        id: 'contact-supreeth',
        name: 'Supreeth Kumar',
        phone: '+919999999999',
        last_inquired_property_id: 'property-1194',
      },
    ];
    parseEventsFromInput.mockResolvedValue([
      notify({
        recipient_name: 'Supreeth',
        title: 'Inform Supreeth about the owner price floor',
        notes: 'Owner has not agreed to go below 40k per sqft.',
      }),
    ]);

    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText:
        'Need to inform Supreeth that owner has not agreed to come below 40k per sqft.',
    });

    expect(parseEventsFromInput).toHaveBeenCalledWith(
      expect.objectContaining({
        memberNames: ['Praneeth', 'Sharan'],
        contactNames: ['Supreeth Kumar'],
      })
    );

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    expect(createNotification).not.toHaveBeenCalled();
    expect(inserts.filter((i) => i.table === 'todos' || i.table === 'appointments')).toEqual([]);
    expect(card()).toContain('📨 *Update sent to Supreeth Kumar*');
    expect(card()).toContain('Inform Supreeth about the owner price floor');
  });

  it('falls back to a Utility template when free-form is blocked', async () => {
    tables.contacts = [{ id: 'contact-supreeth', name: 'Supreeth Kumar', phone: '+919999999999' }];
    const template = buildCallUpdateTemplatePayload();
    loadTemplateForContact.mockResolvedValue({
      template,
      language: 'en_US',
      fellBack: false,
    });
    sendWhatsAppMessageAndPersist
      .mockResolvedValueOnce({
        success: false,
        error: new Error('Re-Engagement message required'),
      })
      .mockResolvedValueOnce({ success: true });
    parseEventsFromInput.mockResolvedValue([
      notify({
        recipient_name: 'Supreeth',
        title: 'Inform Supreeth about the owner price floor',
        notes: 'Owner has not agreed to go below 40k per sqft.',
      }),
    ]);

    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText:
        'Need to inform Supreeth that owner has not agreed to come below 40k per sqft.',
    });

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(2);
    expect(sendWhatsAppMessageAndPersist.mock.calls[0][0]).toMatchObject({
      kind: 'text',
      contactId: 'contact-supreeth',
      senderType: 'agent',
      conversationId: 'conv-1',
    });
    expect(sendWhatsAppMessageAndPersist.mock.calls[1][0]).toMatchObject({
      kind: 'template',
      templateName: template.name,
      senderType: 'agent',
      conversationId: 'conv-1',
    });
    expect(card()).toContain('✅ *Update sent to Supreeth Kumar*');
    expect(card()).toContain('📱 Sent as a WhatsApp business message and tracked in Inbox.');
  });

  it('asks for clarification when a name matches a client and teammate', async () => {
    tables.contacts = [
      { id: 'contact-sharan', name: 'Sharan', phone: '+919999999999' },
    ];
    parseEventsFromInput.mockResolvedValue([notify()]);

    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText: 'Tell Sharan that the owner accepted the offer',
    });

    expect(createNotification).not.toHaveBeenCalled();
    expect(
      inserts.filter((i) => i.table === 'todos' || i.table === 'appointments')
    ).toEqual([]);
    expect(card()).toContain('Which person do you mean?');
    expect(card()).toContain('both a client and a teammate');
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
    tables.contacts = [{ id: 'contact-c-kumar', name: 'C Kumar', phone: '+919999999999' }];
    parseEventsFromInput.mockResolvedValue([
      notify({ recipient_name: 'C Kumar' }),
      task({ start_time: '2026-08-20T10:00' }),
    ]);

    const handled = await tryHandleOwnerScheduling({
      ...baseParams,
      contentText:
        "Inform C Kumar about the latest update. The advocate isn't available for a week, so remind me to follow up after that",
    });

    expect(handled).toBe(true);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    expect(createNotification).not.toHaveBeenCalled();

    const todos = inserts.filter((i) => i.table === 'todos');
    expect(todos).toHaveLength(1);
    expect(todos[0].row.title).toBe("Follow up with Kusumaraju's advocate");

    expect(card()).toContain('📨 *Update sent to C Kumar*');
    expect(card()).toContain('✅ *Task added to your list*');
    // One footer, at the end, however many requests the message carried.
    expect(card().match(/Reply \*today\*/g)).toHaveLength(1);
    expect(card().trimEnd().endsWith("day's schedule._")).toBe(true);
  });

  it('creates a September 24 reminder as a separate task', async () => {
    tables.contacts = [{ id: 'contact-c-kumar', name: 'C Kumar', phone: '+919999999999' }];
    parseEventsFromInput.mockResolvedValue([
      notify({ recipient_name: 'C Kumar' }),
      task({
        start_time: '2026-09-24T10:00',
        title: 'Follow up with C Kumar',
      }),
    ]);

    await tryHandleOwnerScheduling({
      ...baseParams,
      contentText:
        'Can you update C Kumar about this and remind me to follow up on September 24?',
    });

    const todos = inserts.filter((i) => i.table === 'todos');
    expect(todos).toHaveLength(1);
    expect(todos[0].row.due_date).toBe('2026-09-24T04:30:00.000Z');
    expect(todos[0].row.title).toBe('Follow up with C Kumar');
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    expect(card()).toContain('📨 *Update sent to C Kumar*');
    expect(card()).toContain('✅ *Task added to your list*');
  });

  it.each([
    'Can you update C Kumar about this and remind me to follow up on September 24?',
    'Inform C Kumar about this update and set a follow-up reminder for Sept 24.',
    'Please notify C Kumar about Suleiman client / 9,600 sqft Jayanagar plot and add a follow-up reminder on Sept 24',
    'Can you update C Kumar about Suleiman\'s client / 9,600 sqft Jayanagar plot and set a reminder for September 24?',
  ])(
    'supports follow-up phrasing variant: %s',
    async (contentText) => {
      tables.contacts = [{ id: 'contact-c-kumar', name: 'C Kumar', phone: '+919999999999' }];
      parseEventsFromInput.mockResolvedValue([
        notify({
          recipient_name: 'C Kumar',
          title: 'Client update',
          notes: "Suleiman client's 9,600 sqft Jayanagar plot is approved",
        }),
        task({
          start_time: '2026-09-24T10:00',
          title: 'Follow up with C Kumar',
          notes: 'Reminder about 9,600 sqft Jayanagar plot update',
        }),
      ]);

      await tryHandleOwnerScheduling({
        ...baseParams,
        contentText,
      });

      const todos = inserts.filter((i) => i.table === 'todos');
      expect(todos).toHaveLength(1);
      expect(todos[0].row.due_date).toBe('2026-09-24T04:30:00.000Z');
      expect(todos[0].row.title).toBe('Follow up with C Kumar');
      expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
      expect(card()).toContain('📨 *Update sent to C Kumar*');
      expect(card()).toContain('✅ *Task added to your list*');
      expect(card()).not.toContain('Task updated');
    }
  );

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
