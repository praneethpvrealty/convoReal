import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.1' })),
}));
const createNotification = vi.fn();
vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));
const ensureJourneyItem = vi.fn();
vi.mock('@/lib/journey/capture-server', () => ({
  ensureJourneyItem: (...args: unknown[]) => ensureJourneyItem(...args),
  loadJourneyStages: vi.fn(async () => [
    { id: 'stage-new', name: 'New Inquiry', position: 0 },
  ]),
}));

const {
  CHECKBACK_ALT_PROMPT,
  buildCheckBackConfirmBody,
  buildCheckBackConfirmButtons,
  captureTypedCheckBack,
  handleCheckBackConfirmReply,
  handleInboxCheckinReply,
  parseCheckBackConfirmReplyId,
  statesNewRequirement,
} = await import('./client-response');

const NOW = new Date(2026, 8, 29, 18, 28);
const PROPERTY_TITLE =
  '2450 Sqft South facing residential plot for sale in Vijaya Bank Layout';

const CHECKIN_TEMPLATE_TEXT =
  'Hi Ramanathan, this is a check-in on your property enquiry with Aryavarta Ventures:\n\n' +
  `Property: #493, ${PROPERTY_TITLE}, bannerghatta Road, Bilekahalli, Bengaluru\n\n` +
  'We have had no update from you on this listing, so your enquiry is still open against it.';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let writes: Array<{ table: string; op: string; row: Row }>;

function makeDb() {
  return {
    from(table: string) {
      const result = () => ({ data: tables[table] ?? [], error: null });
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of [
        'select',
        'eq',
        'in',
        'is',
        'not',
        'order',
        'limit',
        'gte',
      ])
        builder[m] = chain;
      builder.insert = (row: Row) => {
        writes.push({ table, op: 'insert', row });
        return builder;
      };
      builder.update = (row: Row) => {
        writes.push({ table, op: 'update', row });
        return builder;
      };
      builder.maybeSingle = async () => ({
        data: (tables[table] ?? [])[0] ?? null,
        error: null,
      });
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve);
      return builder;
    },
  } as never;
}

const contact = { id: 'c-1', name: 'Ramanathan' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  writes = [];
  tables = {
    journey_items: [
      {
        id: 'item-1',
        contact_id: 'c-1',
        property_id: 'p-1',
        stage_id: 'stage-new',
        status: 'active',
      },
    ],
    properties: [
      { id: 'p-1', title: PROPERTY_TITLE, property_code: 'PROP-1000' },
    ],
    journey_stages: [
      { id: 'stage-new', name: 'New Inquiry', position: 0 },
      { id: 'stage-qualified', name: 'Qualified', position: 1 },
    ],
    todos: [],
  };
  sendWhatsAppMessageAndPersist.mockReset();
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
  createNotification.mockReset();
  ensureJourneyItem.mockReset();
  ensureJourneyItem.mockResolvedValue({
    id: 'item-1',
    stage_id: 'stage-new',
    status: 'active',
  });
});

function todoWrite() {
  return writes.find((w) => w.table === 'todos' && w.op === 'insert')?.row;
}

describe('[JRN-015] confirming a typed check-back date', () => {
  it('asks to check back in a week, naming the date, with two buttons', () => {
    const due = new Date(2026, 9, 6, 23, 59);
    expect(
      buildCheckBackConfirmBody({ contactName: 'Ramanathan K', due, now: NOW })
    ).toBe(
      '👍 Noted, Ramanathan — shall I check back with you in a week, on *Tuesday, 6 October*?'
    );
    const buttons = buildCheckBackConfirmButtons(due);
    expect(buttons).toEqual([
      { id: 'jcd_ok:2026-10-06', title: 'Yes, 6 Oct' },
      { id: 'jcd_alt', title: 'Another date' },
    ]);
    for (const b of buttons) expect(b.title.length).toBeLessThanOrEqual(20);
  });

  it('round-trips the confirm ids and rejects foreign ones', () => {
    const parsed = parseCheckBackConfirmReplyId('jcd_ok:2026-10-06');
    expect(parsed).toMatchObject({ confirmed: true });
    expect(parsed && parsed.confirmed && parsed.due.getDate()).toBe(6);
    expect(parseCheckBackConfirmReplyId('jcd_alt')).toEqual({
      confirmed: false,
    });
    expect(parseCheckBackConfirmReplyId('jcd_ok:2026-02-31')).toBeNull();
    expect(parseCheckBackConfirmReplyId('jfu_2d:item-1')).toBeNull();
  });
});

describe('[JRN-015] captureTypedCheckBack', () => {
  it('files the reminder for "wait for a week" and asks the client to confirm', async () => {
    const reply = await captureTypedCheckBack({
      db: makeDb(),
      accountId: 'acc-1',
      ownerUserId: 'owner-1',
      contact,
      text: 'You need to wait for a week',
      previousBotText:
        'Hi Ramanathan, noted your update.\n\nWhen should we check back with you?',
      now: NOW,
    });

    expect(reply?.text).toContain('in a week, on *Tuesday, 6 October*');
    expect(reply?.buttons?.[0].id).toBe('jcd_ok:2026-10-06');

    const todo = todoWrite();
    expect(todo).toMatchObject({
      account_id: 'acc-1',
      contact_id: 'c-1',
      property_id: 'p-1',
      source: 'system',
      completed: false,
    });
    expect(new Date(todo!.due_date as string).getDate()).toBe(6);
    expect(
      writes.find((w) => w.table === 'journey_items' && w.op === 'update')?.row
    ).toMatchObject({
      planned_at: '2026-10-06',
      planned_stage_id: 'stage-qualified',
    });
    expect(
      writes.find((w) => w.table === 'contacts' && w.op === 'update')?.row
    ).toHaveProperty('pitch_quiet_until');
    expect(
      writes.find((w) => w.table === 'journey_events')?.row.reason
    ).toContain('6 Oct 2026');
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-1', entityId: 'c-1' })
    );
  });

  it('moves the open reminder instead of adding a second one', async () => {
    tables.todos = [{ id: 'todo-1' }];
    await captureTypedCheckBack({
      db: makeDb(),
      accountId: 'acc-1',
      ownerUserId: 'owner-1',
      contact,
      text: 'in 10 days',
      previousBotText: 'When should we check back with you?',
      now: NOW,
    });
    expect(todoWrite()).toBeUndefined();
    expect(writes.some((w) => w.table === 'todos' && w.op === 'update')).toBe(
      true
    );
  });

  it('acknowledges a replacement date without asking again', async () => {
    const reply = await captureTypedCheckBack({
      db: makeDb(),
      accountId: 'acc-1',
      ownerUserId: 'owner-1',
      contact,
      text: '15 October',
      previousBotText: CHECKBACK_ALT_PROMPT,
      now: NOW,
    });
    expect(reply).toEqual({
      text: "📅 Done — we'll check back with you on 15 October.",
    });
    expect(todoWrite()).toBeDefined();
  });

  it('files no reminder when no date was named', async () => {
    const reply = await captureTypedCheckBack({
      db: makeDb(),
      accountId: 'acc-1',
      ownerUserId: 'owner-1',
      contact,
      text: 'will let you know',
      previousBotText: 'When should we check back with you?',
      now: NOW,
    });
    expect(reply?.buttons).toBeUndefined();
    expect(todoWrite()).toBeUndefined();
  });

  it('ignores replies to anything but the timeline question', async () => {
    const reply = await captureTypedCheckBack({
      db: makeDb(),
      accountId: 'acc-1',
      ownerUserId: 'owner-1',
      contact,
      text: 'in a week',
      previousBotText: 'Here are three new listings',
      now: NOW,
    });
    expect(reply).toBeNull();
    expect(writes).toEqual([]);
  });
});

describe('[JRN-015] the confirm taps', () => {
  const args = {
    db: makeDb(),
    accountId: 'acc-1',
    ownerUserId: 'owner-1',
    contact: { ...contact, phone: '919800000000' },
    conversationId: 'conv-1',
  };

  it('acknowledges the date on yes', async () => {
    expect(
      await handleCheckBackConfirmReply({
        ...args,
        replyId: 'jcd_ok:2026-10-06',
      })
    ).toBe(true);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "📅 Done — we'll check back with you on 6 October.",
      })
    );
  });

  it('asks for another date', async () => {
    expect(
      await handleCheckBackConfirmReply({ ...args, replyId: 'jcd_alt' })
    ).toBe(true);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ text: CHECKBACK_ALT_PROMPT })
    );
    expect(CHECKBACK_ALT_PROMPT).toMatch(/when should we check back with you/i);
  });

  it('leaves other ids alone', async () => {
    expect(
      await handleCheckBackConfirmReply({ ...args, replyId: 'jfu_2d:item-1' })
    ).toBe(false);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });
});

describe('[JRN-015] a typed reply to the check-in template', () => {
  it('is logged on the journey, files the reminder and asks to confirm the date', async () => {
    tables.messages = [
      {
        content_text: CHECKIN_TEMPLATE_TEXT,
        created_at: new Date(NOW.getTime() - 60_000).toISOString(),
        template_name: 'enquiry_checkin_notice',
      },
    ];

    const outcome = await handleInboxCheckinReply({
      db: makeDb(),
      accountId: 'acc-1',
      ownerUserId: 'owner-1',
      contact: { ...contact, phone: '919800000000' },
      conversationId: 'conv-1',
      responseText: 'You need to wait for a week',
      accessToken: 'token',
      phoneNumberId: 'pn-1',
    });

    expect(outcome).toBe('logged_and_asked');
    expect(
      writes.some(
        (w) =>
          w.table === 'journey_events' &&
          w.row.reason === 'You need to wait for a week'
      )
    ).toBe(true);
    expect(todoWrite()).toMatchObject({
      contact_id: 'c-1',
      property_id: 'p-1',
    });
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'interactive',
        interactiveType: 'buttons',
        interactiveBody: expect.stringContaining(
          'in a week, on *Tuesday, 6 October*'
        ),
        interactiveButtons: buildCheckBackConfirmButtons(new Date(2026, 9, 6)),
      })
    );
  });

  it('still recognises an unrelated last message as not a check-in', async () => {
    tables.messages = [
      {
        content_text: 'Here are three new listings',
        created_at: new Date(NOW.getTime() - 60_000).toISOString(),
        template_name: null,
      },
    ];
    const outcome = await handleInboxCheckinReply({
      db: makeDb(),
      accountId: 'acc-1',
      ownerUserId: 'owner-1',
      contact: { ...contact, phone: '919800000000' },
      conversationId: 'conv-1',
      responseText: 'Out of town',
      accessToken: 'token',
      phoneNumberId: 'pn-1',
    });
    expect(outcome).toBe('not_checkin');
  });
});

describe('[JRN-019] a requirement typed in reply to the check-in', () => {
  beforeEach(() => {
    tables.messages = [
      {
        content_text: CHECKIN_TEMPLATE_TEXT,
        created_at: new Date(NOW.getTime() - 60_000).toISOString(),
        template_name: 'enquiry_checkin_notice',
      },
    ];
  });

  const reply = (responseText: string) =>
    handleInboxCheckinReply({
      db: makeDb(),
      accountId: 'acc-1',
      ownerUserId: 'owner-1',
      contact: { ...contact, phone: '919800000000' },
      conversationId: 'conv-1',
      responseText,
      accessToken: 'token',
      phoneNumberId: 'pn-1',
    });

  it('is left for requirement matching, not logged against the checked-in listing', async () => {
    const outcome = await reply('Hsr layout 30x40 north and east facing only');

    expect(outcome).toBe('not_checkin');
    expect(writes).toEqual([]);
    expect(ensureJourneyItem).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it.each([
    'Hsr layout 30x40 north and east facing only',
    'I need a villa available next week',
    '2 BHK in Whitefield under 90 lakh',
  ])('reads %j as a new requirement', (text) => {
    expect(statesNewRequirement(text)).toBe(true);
  });

  it.each([
    'not interested in this plot',
    'Does this villa have clear title?',
    'Check back in a week, need a 30x40 plot',
    'You need to wait for a week',
    'Ok thanks',
  ])('does not read %j as a new requirement', (text) => {
    expect(statesNewRequirement(text)).toBe(false);
  });

  it('still logs a question about the listing on its journey', async () => {
    const outcome = await reply('Does this plot have clear title?');

    expect(outcome).not.toBe('not_checkin');
    expect(
      writes.some(
        (w) =>
          w.table === 'journey_events' &&
          w.row.reason === 'Does this plot have clear title?'
      )
    ).toBe(true);
  });

  it('still files the check-back when the reply also names a date', async () => {
    const outcome = await reply('Check back in a week, need a 30x40 plot');

    expect(outcome).toBe('logged_and_asked');
    expect(todoWrite()).toMatchObject({
      contact_id: 'c-1',
      property_id: 'p-1',
    });
  });
});
