import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();
const sendAlertsOnboarding = vi.fn();
const createNotification = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

vi.mock('@/lib/whatsapp/alerts-onboarding', () => ({
  sendAlertsOnboarding: (...args: unknown[]) => sendAlertsOnboarding(...args),
}));

vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));

const {
  ENQUIRY_REVIEW_KEEP_ID,
  buildEnquiryReviewBody,
  buildEnquiryReviewSections,
  closePropertyEnquiry,
  continueAfterEnquiryClose,
  handleEnquiryReviewReply,
  loadOpenEnquiries,
  parseEnquiryReviewReply,
} = await import('./enquiry-review');

/**
 * [INB-010] Closing one listing is not closing the search. After a
 * close the lead sees what else is still open on their journey, closes
 * any of it with a tap or keeps the lot, and the requirement ladder
 * follows — so the moment they gave us ends with both their enquiries
 * and their brief sorted.
 */

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

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
      'upsert',
      'update',
      'insert',
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

const openRows = [
  {
    id: 'item-2',
    property: {
      id: P2,
      title: 'Office in HSR Layout',
      property_code: 'PROP-1003',
    },
  },
  {
    id: 'item-3',
    property: { id: P3, title: 'Villa in Sarjapur', property_code: null },
  },
];

const enquiries = openRows.map((r) => ({ itemId: r.id, property: r.property }));

const baseArgs = {
  accountId: 'acct-1',
  userId: 'owner-1',
  contactId: 'c1',
  conversationId: 'conv-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
  sendAlertsOnboarding.mockResolvedValue(undefined);
  createNotification.mockResolvedValue({});
});

describe('loadOpenEnquiries', () => {
  it('[INB-010] reads only the active journey branches, newest first, capped at the list size', async () => {
    const { db, calls } = stubDb({ journey_items: [openRows] });

    const open = await loadOpenEnquiries(db, 'acct-1', 'c1');

    expect(open.map((e) => e.property.id)).toEqual([P2, P3]);
    const eqs = calls
      .filter((c) => c.table === 'journey_items' && c.method === 'eq')
      .map((c) => c.args);
    expect(eqs).toEqual([
      ['account_id', 'acct-1'],
      ['contact_id', 'c1'],
      ['status', 'active'],
    ]);
    expect(
      calls.find((c) => c.table === 'journey_items' && c.method === 'limit')
        ?.args
    ).toEqual([9]);
  });

  it('skips branches whose property is gone', async () => {
    const { db } = stubDb({
      journey_items: [[{ id: 'item-9', property: null }, openRows[0]]],
    });
    const open = await loadOpenEnquiries(db, 'acct-1', 'c1');
    expect(open.map((e) => e.itemId)).toEqual(['item-2']);
  });
});

describe('closePropertyEnquiry', () => {
  it('[INB-010] rejects the listing, drops its journey branch and notes it, leaving the contact alone', async () => {
    const { db, calls } = stubDb({
      journey_items: [{ id: 'item-1', stage_id: 'stage-a' }],
    });

    await closePropertyEnquiry({
      db,
      accountId: 'acct-1',
      contact: { id: 'c1', name: 'Vasudha Rao' },
      property: {
        id: P1,
        title: 'Renovated 4BHK Villa',
        property_code: 'PROP-1559',
      },
    });

    expect(
      calls.find((c) => c.table === 'listing_feedback' && c.method === 'upsert')
        ?.args[0]
    ).toMatchObject({ contact_id: 'c1', property_id: P1, verdict: 'rejected' });
    expect(
      calls.find((c) => c.table === 'journey_items' && c.method === 'update')
        ?.args[0]
    ).toMatchObject({
      status: 'dropped',
      drop_reason: 'Lead closed their enquiry from WhatsApp',
      dropped_at: expect.any(String),
    });
    expect(
      calls.find((c) => c.table === 'journey_events' && c.method === 'insert')
        ?.args[0]
    ).toMatchObject({
      item_id: 'item-1',
      event_type: 'dropped',
      from_stage_id: 'stage-a',
    });
    expect(
      calls.find((c) => c.table === 'contact_notes' && c.method === 'insert')
        ?.args[0]
    ).toMatchObject({
      contact_id: 'c1',
      note_text: expect.stringContaining(
        'Vasudha closed their enquiry on Renovated 4BHK Villa (PROP-1559)'
      ),
    });
    expect(calls.some((c) => c.table === 'contacts')).toBe(false);
  });

  it('files the rejection even when the pair was never on the journey', async () => {
    const { db, calls } = stubDb({ journey_items: [null] });
    await closePropertyEnquiry({
      db,
      accountId: 'acct-1',
      contact: { id: 'c1' },
      property: { id: P1, title: 'Plot' },
    });
    expect(
      calls.some((c) => c.table === 'listing_feedback' && c.method === 'upsert')
    ).toBe(true);
    expect(
      calls.some((c) => c.table === 'journey_events' && c.method === 'insert')
    ).toBe(false);
  });
});

describe('buildEnquiryReviewBody / buildEnquiryReviewSections', () => {
  it('[INB-010] numbers every open enquiry and offers a close per row plus one keep row', () => {
    const body = buildEnquiryReviewBody(enquiries, 'Thank you — that helps.');
    expect(body.startsWith('Thank you — that helps.')).toBe(true);
    expect(body).toContain('You still have 2 open enquiries with us:');
    expect(body).toContain('1. Office in HSR Layout (PROP-1003)');
    expect(body).toContain('2. Villa in Sarjapur');

    const rows = buildEnquiryReviewSections(enquiries)[0].rows;
    expect(rows.map((r) => r.id)).toEqual([
      `enqrev_close_${P2}`,
      `enqrev_close_${P3}`,
      ENQUIRY_REVIEW_KEEP_ID,
    ]);
    for (const row of rows) {
      expect(row.title.length).toBeLessThanOrEqual(24);
    }
    expect(rows.length).toBeLessThanOrEqual(10);
  });

  it('never exceeds ten rows however many enquiries are open', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      itemId: `item-${i}`,
      property: {
        id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
        title: `Listing ${i}`,
      },
    }));
    expect(buildEnquiryReviewSections(many)[0].rows.length).toBe(10);
  });
});

describe('continueAfterEnquiryClose', () => {
  it('[INB-010] shows the open enquiries when there are any', async () => {
    const { db } = stubDb({ journey_items: [openRows] });
    const outcome = await continueAfterEnquiryClose({
      db,
      ...baseArgs,
      acknowledgement: 'Thanks.',
    });
    expect(outcome).toBe('review');
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        interactiveType: 'list',
        allowDeadContact: true,
        interactiveBody: expect.stringContaining('Thanks.'),
      })
    );
    expect(sendAlertsOnboarding).not.toHaveBeenCalled();
  });

  it('[INB-010] runs the requirement ladder with the same acknowledgement when nothing is open', async () => {
    const { db } = stubDb({ journey_items: [[]] });
    const outcome = await continueAfterEnquiryClose({
      db,
      ...baseArgs,
      acknowledgement: 'Thanks.',
    });
    expect(outcome).toBe('ladder');
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(sendAlertsOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1', acknowledgement: 'Thanks.' })
    );
  });

  it('stands down entirely for a review-only continuation with nothing open', async () => {
    const { db } = stubDb({ journey_items: [[]] });
    const outcome = await continueAfterEnquiryClose({
      db,
      ...baseArgs,
      reviewOnly: true,
    });
    expect(outcome).toBe('none');
    expect(sendAlertsOnboarding).not.toHaveBeenCalled();
  });
});

describe('parseEnquiryReviewReply', () => {
  it('accepts only its own well-formed ids', () => {
    expect(parseEnquiryReviewReply(ENQUIRY_REVIEW_KEEP_ID)).toEqual({
      action: 'keep',
    });
    expect(parseEnquiryReviewReply(`enqrev_close_${P1}`)).toEqual({
      action: 'close',
      propertyId: P1,
    });
    expect(parseEnquiryReviewReply('enqrev_close_not-a-uuid')).toBeNull();
    expect(parseEnquiryReviewReply(`lfbd_budget_${P1}`)).toBeNull();
  });
});

describe('handleEnquiryReviewReply', () => {
  const args = (db: never, replyId: string) => ({
    db,
    accountId: 'acct-1',
    configOwnerUserId: 'owner-1',
    contact: { id: 'c1', name: 'Vasudha Rao' },
    conversationId: 'conv-1',
    replyId,
  });

  it('ignores ids it does not own', async () => {
    const { db } = stubDb({});
    expect(await handleEnquiryReviewReply(args(db, `lfb_y_${P1}`))).toBe(false);
  });

  it('[INB-010] a close files the listing, tells the agent and re-sends the list with the rest', async () => {
    const { db, calls } = stubDb({
      properties: [
        {
          id: P2,
          title: 'Office in HSR Layout',
          property_code: 'PROP-1003',
          user_id: 'u9',
        },
      ],
      journey_items: [
        { id: 'item-2', stage_id: 'stage-a' },
        null,
        [openRows[1]],
      ],
      contacts: [{ assigned_agent_id: 'agent-7' }],
    });

    const handled = await handleEnquiryReviewReply(
      args(db, `enqrev_close_${P2}`)
    );

    expect(handled).toBe(true);
    expect(
      calls.find((c) => c.table === 'journey_items' && c.method === 'update')
        ?.args[0]
    ).toMatchObject({ status: 'dropped' });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'agent-7',
        entityId: 'c1',
        title: expect.stringContaining(
          'closed their enquiry on Office in HSR Layout'
        ),
      })
    );
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        interactiveType: 'list',
        interactiveBody: expect.stringContaining(
          'Office in HSR Layout (PROP-1003)* is off your list'
        ),
      })
    );
    const body = (
      sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
        interactiveBody: string;
      }
    ).interactiveBody;
    expect(body).toContain('1. Villa in Sarjapur');
    expect(sendAlertsOnboarding).not.toHaveBeenCalled();
  });

  it('[INB-010] the last close hands over to the requirement ladder', async () => {
    const { db } = stubDb({
      properties: [
        {
          id: P3,
          title: 'Villa in Sarjapur',
          property_code: null,
          user_id: null,
        },
      ],
      journey_items: [{ id: 'item-3', stage_id: 'stage-a' }, null, []],
      contacts: [{ assigned_agent_id: null }],
    });

    await handleEnquiryReviewReply(args(db, `enqrev_close_${P3}`));

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-1' })
    );
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(sendAlertsOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c1',
        acknowledgement: expect.stringContaining('Villa in Sarjapur'),
      })
    );
  });

  it('[INB-010] keep logs "still considering" on every open branch and runs the ladder', async () => {
    const { db, calls } = stubDb({ journey_items: [openRows, null, null] });

    const handled = await handleEnquiryReviewReply(
      args(db, ENQUIRY_REVIEW_KEEP_ID)
    );

    expect(handled).toBe(true);
    const events = calls.filter(
      (c) => c.table === 'journey_events' && c.method === 'insert'
    );
    expect(
      events.map((e) => (e.args[0] as { item_id: string }).item_id)
    ).toEqual(['item-2', 'item-3']);
    expect(events[0].args[0]).toMatchObject({
      event_type: 'client_response',
      reason: 'Still considering it',
    });
    expect(sendAlertsOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        acknowledgement: expect.stringContaining('stay open'),
      })
    );
  });

  it('records nothing for a property outside the account', async () => {
    const { db, calls } = stubDb({ properties: [null] });
    expect(await handleEnquiryReviewReply(args(db, `enqrev_close_${P1}`))).toBe(
      false
    );
    expect(
      calls.some((c) => c.table === 'listing_feedback' && c.method === 'upsert')
    ).toBe(false);
  });
});
