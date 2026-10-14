import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();
const createNotification = vi.fn();
const continueAfterEnquiryClose = vi.fn();
const markContactDead = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));

vi.mock('@/lib/whatsapp/enquiry-review', () => ({
  continueAfterEnquiryClose: (...args: unknown[]) =>
    continueAfterEnquiryClose(...args),
}));

vi.mock('@/lib/contacts/lifecycle', () => ({
  markContactDead: (...args: unknown[]) => markContactDead(...args),
}));

const {
  buildEnquiryDropoffSections,
  handleEnquiryDropoffReason,
  parseEnquiryDropoffReply,
  resolveDroppedProperty,
  sendEnquiryDropoffPrompt,
} = await import('./enquiry-dropoff');

/**
 * [INB-009] A lead who closes their enquiry from WhatsApp is asked why
 * the shared property did not fit. These pin the capture: the property
 * is found from what was actually sent, the one-tap answer lands on
 * listing_feedback, the contact timeline and the journey, both sends
 * bypass the dead-contact gate, and nothing embedded in a webhook id
 * is trusted. The thank-you then hands over to the open-enquiry review
 * and the requirement ladder — closing one listing is not closing the
 * search — except for the two answers that end it.
 */

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

const NOW = new Date('2026-09-21T06:52:00Z');
const recent = (h: number) =>
  new Date(NOW.getTime() - h * 3600_000).toISOString();

/** Chainable query stub: every method returns itself; awaiting any
 *  chain resolves to the next queued result for that table. */
function stubDb(results: Record<string, unknown[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const queues = new Map(Object.entries(results));
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    const handler =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    for (const m of [
      'select',
      'eq',
      'in',
      'upsert',
      'update',
      'insert',
      'gte',
      'order',
      'limit',
    ]) {
      chain[m] = handler(m);
    }
    chain.maybeSingle = async () => {
      calls.push({ table, method: 'maybeSingle', args: [] });
      const q = queues.get(table) ?? [];
      return { data: q.shift() ?? null };
    };
    (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => {
      const q = queues.get(table) ?? [];
      return Promise.resolve(resolve({ data: q.shift() ?? null }));
    };
    return chain;
  };
  return { db: { from } as never, calls };
}

const properties = [
  {
    id: P1,
    title: 'Commercial Plot for Sale in Jayanagar 7th Block',
    property_code: 'PROP-1002',
  },
  { id: P2, title: 'Office in HSR Layout', property_code: 'PROP-1003' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
  createNotification.mockResolvedValue({});
  continueAfterEnquiryClose.mockResolvedValue('review');
  markContactDead.mockResolvedValue(true);
});

describe('resolveDroppedProperty', () => {
  const baseArgs = (db: never, contextMessageId: string | null) => ({
    db,
    accountId: 'acct-1',
    contact: { id: 'c1' },
    conversationId: 'conv-1',
    contextMessageId,
  });

  it('[INB-009] reads the property out of the quoted check-in the lead tapped', async () => {
    const { db } = stubDb({
      properties: [properties],
      messages: [
        {
          content_text:
            'Hi Mr. Rohit, this is a check-in on your property enquiry:\n\nProperty: Commercial Plot for Sale in Jayanagar 7th Block, Bengaluru',
          created_at: recent(20),
        },
      ],
    });

    const found = await resolveDroppedProperty(baseArgs(db, 'wamid.quoted'));

    expect(found?.id).toBe(P1);
  });

  it('[INB-009] falls back to the last week of outbound messages, then the recorded enquiry', async () => {
    const { db: threadDb, calls } = stubDb({
      properties: [properties],
      messages: [
        null,
        [
          { content_text: 'Thanks, noted.', created_at: recent(2) },
          {
            content_text: 'Sharing PROP-1003 with you',
            created_at: recent(30),
          },
        ],
      ],
    });
    const fromThread = await resolveDroppedProperty(
      baseArgs(threadDb, 'wamid.unknown')
    );
    expect(fromThread?.id).toBe(P2);
    // The week is applied in the query, before any row bound, so a
    // share buried under newer chatter is still scanned.
    const window = calls.find(
      (c) => c.table === 'messages' && c.method === 'gte'
    );
    expect(window?.args).toEqual([
      'created_at',
      new Date(NOW.getTime() - 7 * 24 * 3600_000).toISOString(),
    ]);

    const { db: enquiryDb } = stubDb({
      properties: [properties],
      messages: [[]],
    });
    const fromEnquiry = await resolveDroppedProperty({
      ...baseArgs(enquiryDb, null),
      contact: { id: 'c1', last_inquired_property_id: P1 },
    });
    expect(fromEnquiry?.id).toBe(P1);

    const { db: emptyDb } = stubDb({
      properties: [properties],
      messages: [[]],
    });
    expect(await resolveDroppedProperty(baseArgs(emptyDb, null))).toBeNull();
  });
});

describe('sendEnquiryDropoffPrompt', () => {
  it('[INB-009] asks why with rows the dead-contact gate lets through, without promising silence', async () => {
    const { db, calls } = stubDb({});

    const sent = await sendEnquiryDropoffPrompt({
      db,
      accountId: 'acct-1',
      userId: 'owner-1',
      contactId: 'c1',
      conversationId: 'conv-1',
      property: properties[0],
    });

    expect(sent).toBe(true);
    // The close itself files the rejection; the question only asks.
    expect(
      calls.some((c) => c.table === 'listing_feedback' && c.method === 'upsert')
    ).toBe(false);
    const message = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      allowDeadContact: boolean;
      interactiveBody: string;
      interactiveSections: { rows: { id: string; title: string }[] }[];
    };
    expect(message.allowDeadContact).toBe(true);
    expect(message.interactiveBody).toContain(
      'Commercial Plot for Sale in Jayanagar 7th Block'
    );
    // The review and the ladder follow the answer, so the question
    // must not claim to be the last message.
    expect(message.interactiveBody).not.toMatch(/nothing further/i);
    const rows = message.interactiveSections[0].rows;
    expect(rows.map((r) => r.id)).toEqual(
      buildEnquiryDropoffSections(P1)[0].rows.map((r) => r.id)
    );
    expect(rows.map((r) => r.id)).toContain(`lfbd_bought_elsewhere_${P1}`);
    expect(rows.map((r) => r.id)).toContain(`lfbd_not_now_${P1}`);
    for (const row of rows) {
      expect(row.title.length).toBeLessThanOrEqual(24);
    }
  });

  it('never throws when the send fails — the goodbye already landed', async () => {
    sendWhatsAppMessageAndPersist.mockRejectedValueOnce(new Error('blocked'));
    const { db } = stubDb({});
    await expect(
      sendEnquiryDropoffPrompt({
        db,
        accountId: 'acct-1',
        userId: 'owner-1',
        contactId: 'c1',
        conversationId: 'conv-1',
        property: properties[0],
      })
    ).resolves.toBe(false);
  });
});

describe('parseEnquiryDropoffReply', () => {
  it('[INB-009] accepts only its own well-formed ids', () => {
    expect(parseEnquiryDropoffReply(`lfbd_bought_elsewhere_${P1}`)).toEqual({
      reason: 'bought_elsewhere',
      propertyId: P1,
    });
    expect(parseEnquiryDropoffReply(`lfbd_budget_${P1}`)).toEqual({
      reason: 'budget',
      propertyId: P1,
    });
    expect(parseEnquiryDropoffReply(`lfbr_budget_${P1}`)).toBeNull();
    expect(parseEnquiryDropoffReply('lfbd_budget_not-a-uuid')).toBeNull();
    expect(parseEnquiryDropoffReply(`lfbd_spam_${P1}`)).toBeNull();
  });
});

describe('handleEnquiryDropoffReason', () => {
  const baseArgs = (db: never, replyId: string) => ({
    db,
    accountId: 'acct-1',
    configOwnerUserId: 'owner-1',
    contact: { id: 'c1', name: 'Rohit Sharma' },
    conversationId: 'conv-1',
    replyId,
  });

  it('ignores ids it does not own, so other handlers still run', async () => {
    const { db } = stubDb({});
    expect(await handleEnquiryDropoffReason(baseArgs(db, `lfb_y_${P1}`))).toBe(
      false
    );
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('[INB-009] files the reason on the listing, the timeline and the journey, tells the agent, and carries the thanks into the review', async () => {
    const { db, calls } = stubDb({
      properties: [{ ...properties[0], user_id: 'u9' }],
      journey_items: [{ id: 'item-1' }],
      contacts: [{ assigned_agent_id: 'agent-7' }],
    });

    const handled = await handleEnquiryDropoffReason(
      baseArgs(db, `lfbd_budget_${P1}`)
    );

    expect(handled).toBe(true);
    const upsert = calls.find(
      (c) => c.table === 'listing_feedback' && c.method === 'upsert'
    );
    expect(upsert?.args[0]).toMatchObject({
      contact_id: 'c1',
      property_id: P1,
      verdict: 'rejected',
      reason: 'budget',
    });
    const note = calls.find(
      (c) => c.table === 'contact_notes' && c.method === 'insert'
    );
    expect(note?.args[0]).toMatchObject({
      contact_id: 'c1',
      account_id: 'acct-1',
      note_text: expect.stringContaining('Budget too high'),
    });
    const event = calls.find(
      (c) => c.table === 'journey_events' && c.method === 'insert'
    );
    expect(event?.args[0]).toMatchObject({
      item_id: 'item-1',
      event_type: 'client_response',
      reason: expect.stringContaining('Budget too high'),
    });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'agent-7',
        entityType: 'contact',
        entityId: 'c1',
        body: expect.stringContaining('Budget too high'),
      })
    );
    expect(continueAfterEnquiryClose).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c1',
        conversationId: 'conv-1',
        acknowledgement: expect.stringContaining('Thank you'),
        reviewOnly: false,
      })
    );
    expect(markContactDead).not.toHaveBeenCalled();
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('[INB-010] sends the bare thank-you when there is nothing to review and the ladder is not wanted', async () => {
    continueAfterEnquiryClose.mockResolvedValueOnce('none');
    const { db } = stubDb({
      properties: [{ ...properties[0], user_id: null }],
      journey_items: [null],
      contacts: [{ assigned_agent_id: null }],
    });

    await handleEnquiryDropoffReason(baseArgs(db, `lfbd_other_${P1}`));

    expect(continueAfterEnquiryClose).toHaveBeenCalledWith(
      expect.objectContaining({ reviewOnly: true })
    );
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'text',
        allowDeadContact: true,
        text: expect.stringContaining('reply with a line'),
      })
    );
  });

  it('[INB-010] "bought elsewhere" ends the search: the contact is marked dead and only the thank-you follows', async () => {
    const { db } = stubDb({
      properties: [{ ...properties[0], user_id: null }],
      journey_items: [null],
      contacts: [{ assigned_agent_id: null }],
    });

    await handleEnquiryDropoffReason(
      baseArgs(db, `lfbd_bought_elsewhere_${P1}`)
    );

    expect(markContactDead).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        contactId: 'c1',
        reason: 'closed_enquiry',
      })
    );
    expect(continueAfterEnquiryClose).not.toHaveBeenCalled();
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        allowDeadContact: true,
        text: expect.stringContaining('congratulations'),
      })
    );
  });

  it('[INB-010] files the reason on the branch the close already dropped', async () => {
    const { db, calls } = stubDb({
      properties: [{ ...properties[0], user_id: null }],
      journey_items: [{ id: 'item-1' }],
      contacts: [{ assigned_agent_id: null }],
    });

    await handleEnquiryDropoffReason(baseArgs(db, `lfbd_size_${P1}`));

    // The pair is matched whatever its status: the close dropped the
    // branch a message ago, and the reason belongs on that item.
    const filters = calls
      .filter((c) => c.table === 'journey_items' && c.method === 'eq')
      .map((c) => c.args[0]);
    expect(filters).not.toContain('status');
    expect(
      calls.find((c) => c.table === 'journey_events' && c.method === 'insert')
        ?.args[0]
    ).toMatchObject({ item_id: 'item-1', event_type: 'client_response' });
  });

  it('[INB-009] logs nothing on the journey when the pair has no item', async () => {
    const { db, calls } = stubDb({
      properties: [{ ...properties[1], user_id: null }],
      journey_items: [null],
      contacts: [{ assigned_agent_id: null }],
    });

    await handleEnquiryDropoffReason(baseArgs(db, `lfbd_not_now_${P2}`));

    expect(
      calls.some((c) => c.table === 'journey_events' && c.method === 'insert')
    ).toBe(false);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-1' })
    );
    // "Not buying right now" is the lead's answer about the search, so
    // no review or ladder follows: the search is parked (matching and
    // alerts stop) and the thank-you names the way back in.
    expect(continueAfterEnquiryClose).not.toHaveBeenCalled();
    expect(markContactDead).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c1',
        reason: 'closed_enquiry',
        note: expect.stringContaining('not buying right now'),
      })
    );
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        allowDeadContact: true,
        text: expect.stringContaining('START ALERTS'),
      })
    );
  });

  it('records nothing for a property outside the account', async () => {
    const { db, calls } = stubDb({ properties: [null] });

    const handled = await handleEnquiryDropoffReason(
      baseArgs(db, `lfbd_location_${P1}`)
    );

    expect(handled).toBe(false);
    expect(
      calls.some((c) => c.table === 'listing_feedback' && c.method === 'upsert')
    ).toBe(false);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });
});
