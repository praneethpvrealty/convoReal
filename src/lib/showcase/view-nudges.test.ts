import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

interface Query {
  table: string;
  op: 'select' | 'update' | 'insert' | 'upsert' | 'delete';
  payload?: unknown;
  filters: Record<string, unknown>;
}

const h = vi.hoisted(() => ({
  conversationId: null as string | null,
  send: vi.fn(),
  notify: vi.fn(),
  listingFeedback: vi.fn(),
  submit: vi.fn(),
  quiet: false,
  lease: 'run' as 'run' | 'busy',
  conversation: null as { last_customer_message_at: string | null } | null,
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) => h.send(...args),
}));
vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...args: unknown[]) => h.notify(...args),
}));
vi.mock('@/lib/whatsapp/listing-feedback', () => ({
  handleListingFeedbackReply: (...args: unknown[]) =>
    h.listingFeedback(...args),
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  submitMessageTemplate: (...args: unknown[]) => h.submit(...args),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }));
vi.mock('@/lib/notifications/quiet-hours', () => ({
  resolveQuietPeriod: async () => ({ isQuiet: h.quiet, deliverAt: null }),
}));
vi.mock('@/lib/inventory/unavailable-reply', () => ({
  unavailableListingReplyWithShowcase: async (args: { status: string }) =>
    args.status === 'Sold' ? 'Sorry, this one has been sold.' : null,
}));
vi.mock('@/lib/voice/assigned-agent', () => ({
  resolveAssignedAgent: async () => ({ name: 'Sharan Kumar', phone: '91999' }),
}));
vi.mock('@/lib/conversations/resolve', () => ({
  lookupConversation: async () => ({
    conversation: h.conversation
      ? { id: h.conversationId, ...h.conversation }
      : null,
    error: null,
  }),
}));
vi.mock('@/lib/conversations/outbound-lease', () => ({
  withContactConversationLease: async (
    _db: unknown,
    _accountId: string,
    _contactId: string,
    run: () => Promise<unknown>
  ) =>
    h.lease === 'run'
      ? { status: 'ran', value: await run() }
      : { status: 'busy' },
}));

import {
  VIEW_NUDGE_BUTTON_LABELS,
  buildViewNudgeTemplatePayload,
  parseViewNudgeReplyId,
  usableViewNudgeTemplate,
  viewNudgeButtonParams,
  viewNudgeButtons,
  viewNudgeReplyId,
} from './view-nudge-template';
import { processShowcaseViewNudges } from './view-nudges';
import { handleViewNudgeReply } from './view-nudge-reply';

const ACCOUNT = 'acc-1';
const CONTACT = 'contact-1';
const PROPERTY = '11111111-2222-4333-8444-555555555555';
const OWNER = 'owner-user';
const AGENT = 'agent-user';
const VIEWED_AT = new Date(Date.now() - 45 * 60 * 1000).toISOString();

function fakeDb(state: {
  candidates?: Row[];
  claimId?: string | null;
  failInsert?: string;
  failUpdates?: number;
  failSelect?: string;
  tables: Record<string, Row[]>;
}) {
  let failedUpdates = 0;
  const queries: Query[] = [];
  const rpcCalls: Array<{ fn: string; args: Row }> = [];

  const resolve = (q: Query) => {
    queries.push(q);
    if (
      (q.op === 'insert' || q.op === 'upsert') &&
      q.table === state.failInsert
    ) {
      return { data: null, error: { message: 'insert failed' } };
    }
    if (q.op === 'update' && failedUpdates < (state.failUpdates ?? 0)) {
      failedUpdates++;
      return { data: null, error: { message: 'update failed' } };
    }
    if (q.op !== 'select') return { data: null, error: null };
    if (q.table === state.failSelect) {
      return { data: null, error: { message: 'read failed' } };
    }
    const rows = (state.tables[q.table] ?? []).filter((row) =>
      Object.entries(q.filters).every(([k, v]) =>
        Array.isArray(v) ? v.includes(row[k]) : row[k] === v
      )
    );
    return { data: rows, error: null };
  };

  const builder = (table: string) => {
    const q: Query = { table, op: 'select', filters: {} };
    const api = {
      select: () => api,
      update: (payload: unknown) => {
        q.op = 'update';
        q.payload = payload;
        return api;
      },
      delete: () => {
        q.op = 'delete';
        return api;
      },
      insert: (payload: unknown) => {
        q.op = 'insert';
        q.payload = payload;
        return Promise.resolve(resolve(q));
      },
      upsert: (payload: unknown) => {
        q.op = 'upsert';
        q.payload = payload;
        return Promise.resolve(resolve(q));
      },
      eq: (column: string, value: unknown) => {
        q.filters[column] = value;
        return api;
      },
      in: (column: string, values: unknown[]) => {
        q.filters[column] = values;
        return api;
      },
      gte: () => api,
      gt: () => api,
      is: () => api,
      limit: () => api,
      maybeSingle: () => {
        const { data } = resolve(q);
        const { error } = resolve(q);
        return Promise.resolve({
          data: Array.isArray(data) ? (data[0] ?? null) : null,
          error,
        });
      },
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(resolve(q)).then(onFulfilled),
    };
    return api;
  };

  const db = {
    from: builder,
    rpc: async (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      if (fn === 'showcase_view_nudge_candidates') {
        return { data: state.candidates ?? [], error: null };
      }
      return {
        data: state.claimId === undefined ? 'nudge-1' : state.claimId,
        error: null,
      };
    },
  };
  return { db: db as never, queries, rpcCalls };
}

const candidate = {
  account_id: ACCOUNT,
  contact_id: CONTACT,
  property_id: PROPERTY,
  dwell_ms: 42_000,
  viewed_at: VIEWED_AT,
};

function baseTables(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    whatsapp_config: [{ account_id: ACCOUNT, user_id: OWNER }],
    contacts: [
      {
        id: CONTACT,
        account_id: ACCOUNT,
        name: 'Ravi Teja',
        buyer_alerts_consent: 'pending',
        assigned_agent_id: AGENT,
        phone: '919000000001',
      },
    ],
    properties: [
      {
        id: PROPERTY,
        account_id: ACCOUNT,
        title: '3 BHK in Kondapur',
        status: 'Available',
        user_id: 'lister-user',
      },
    ],
    message_templates: [] as Row[],
    ...extra,
  };
}

function nudgeUpdate(queries: Query[]) {
  return queries.find(
    (q) => q.table === 'showcase_view_nudges' && q.op === 'update'
  )?.payload as Row | undefined;
}

beforeEach(() => {
  h.send.mockReset().mockResolvedValue({
    success: true,
    whatsappMessageId: 'wamid.1',
  });
  h.notify.mockReset().mockResolvedValue({});
  h.listingFeedback.mockReset().mockResolvedValue(true);
  h.submit.mockReset().mockResolvedValue({ id: 'meta-1', status: 'PENDING' });
  h.quiet = false;
  h.lease = 'run';
  h.conversation = null;
  h.conversationId = null;
});

describe('[PLS-006] showcase view check-in buttons', () => {
  it('round-trips every choice through its reply id', () => {
    for (const choice of ['visit', 'callback', 'not_for_me'] as const) {
      expect(parseViewNudgeReplyId(viewNudgeReplyId(choice, PROPERTY))).toEqual(
        { choice, propertyId: PROPERTY }
      );
    }
  });

  it('refuses ids it does not own or that carry no property uuid', () => {
    expect(parseViewNudgeReplyId('lfb_y_' + PROPERTY)).toBeNull();
    expect(parseViewNudgeReplyId('svn_x:' + PROPERTY)).toBeNull();
    expect(parseViewNudgeReplyId('svn_v:not-a-uuid')).toBeNull();
    expect(parseViewNudgeReplyId(null)).toBeNull();
  });

  it('offers Book a visit / Call me back / Not for me within Meta limits, in the same order on both channels', () => {
    const buttons = viewNudgeButtons(PROPERTY);
    expect(buttons.map((b) => b.title)).toEqual([
      'Book a visit',
      'Call me back',
      'Not for me',
    ]);
    for (const b of buttons) expect(b.title.length).toBeLessThanOrEqual(20);
    const payload = buildViewNudgeTemplatePayload();
    expect(payload.category).toBe('Utility');
    expect(payload.buttons?.map((b) => b.text)).toEqual(
      Object.values(VIEW_NUDGE_BUTTON_LABELS)
    );
    expect(payload.name).toBe('showcase_view_followup');
    expect(payload.footer_text).toBeUndefined();
    expect(payload.body_text).toContain('Property: {{3}}');
    expect(payload.sample_values?.body).toHaveLength(3);
    const params = viewNudgeButtonParams(PROPERTY);
    expect(buttons.map((b, i) => params[i] === b.id)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('sends a Marketing-categorised template only to a contact who opted into alerts', () => {
    const marketing = {
      name: 'showcase_view_checkin',
      status: 'APPROVED',
      category: 'Marketing',
    };
    expect(usableViewNudgeTemplate([marketing], 'pending')).toBeNull();
    expect(usableViewNudgeTemplate([marketing], 'granted')).toBe(marketing);
    const utility = { ...marketing, category: 'Utility' };
    expect(usableViewNudgeTemplate([utility], 'pending')).toBe(utility);
    expect(
      usableViewNudgeTemplate([{ ...utility, status: 'PENDING' }], 'granted')
    ).toBeNull();
  });

  it('prefers the Utility follow-up over the Marketing check-in, and keeps the old one for opted-in contacts until then', () => {
    const legacy = {
      name: 'showcase_view_checkin',
      status: 'APPROVED',
      category: 'Marketing',
    };
    const followup = {
      name: 'showcase_view_followup',
      status: 'APPROVED',
      category: 'Utility',
    };
    expect(usableViewNudgeTemplate([legacy, followup], 'pending')).toBe(
      followup
    );
    const pendingFollowup = { ...followup, status: 'PENDING' };
    expect(usableViewNudgeTemplate([legacy, pendingFollowup], 'granted')).toBe(
      legacy
    );
    expect(
      usableViewNudgeTemplate([legacy, pendingFollowup], 'pending')
    ).toBeNull();
    const marketingFollowup = { ...followup, category: 'Marketing' };
    expect(
      usableViewNudgeTemplate([legacy, marketingFollowup], 'pending')
    ).toBeNull();
  });
});

describe('[PLS-006] the showcase view check-in sweep', () => {
  it('asks the SQL gate for 30s+ views that settled 30 minutes ago, one per contact', async () => {
    const { db, rpcCalls } = fakeDb({ candidates: [], tables: baseTables() });
    await processShowcaseViewNudges(db);
    expect(rpcCalls[0]).toEqual({
      fn: 'showcase_view_nudge_candidates',
      args: {
        p_min_dwell_ms: 30_000,
        p_settle_minutes: 30,
        p_lookback_hours: 24,
        p_cooldown_days: 3,
        p_limit: 50,
      },
    });
  });

  it('claims nothing during the account client quiet hours', async () => {
    h.quiet = true;
    const { db, rpcCalls } = fakeDb({
      candidates: [candidate],
      tables: baseTables(),
    });
    const totals = await processShowcaseViewNudges(db);
    expect(rpcCalls.map((c) => c.fn)).not.toContain(
      'claim_showcase_view_nudge'
    );
    expect(h.send).not.toHaveBeenCalled();
    expect(totals.sent).toBe(0);
  });

  it('stops claiming once client quiet hours begin partway through a batch', async () => {
    const second = {
      ...candidate,
      property_id: '99999999-2222-4333-8444-555555555555',
    };
    h.conversation = {
      last_customer_message_at: new Date(
        Date.now() - 3 * 60 * 60 * 1000
      ).toISOString(),
    };
    h.send.mockImplementation(async () => {
      h.quiet = true;
      return { success: true, whatsappMessageId: 'wamid.1' };
    });
    const { db, rpcCalls } = fakeDb({
      candidates: [candidate, second],
      tables: baseTables(),
    });
    await processShowcaseViewNudges(db);
    expect(
      rpcCalls.filter((c) => c.fn === 'claim_showcase_view_nudge')
    ).toHaveLength(1);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('sends free-form buttons naming the property while the window is open and stores the wamid', async () => {
    h.conversation = {
      last_customer_message_at: new Date(
        Date.now() - 3 * 60 * 60 * 1000
      ).toISOString(),
    };
    const { db, queries } = fakeDb({
      candidates: [candidate],
      tables: baseTables(),
    });
    const totals = await processShowcaseViewNudges(db);
    expect(totals.sent).toBe(1);
    const args = h.send.mock.calls[0][0];
    expect(args.kind).toBe('interactive');
    expect(args.interactiveBody).toContain('3 BHK in Kondapur');
    expect(args.interactiveButtons.map((b: { id: string }) => b.id)).toEqual([
      `svn_v:${PROPERTY}`,
      `svn_c:${PROPERTY}`,
      `svn_n:${PROPERTY}`,
    ]);
    expect(nudgeUpdate(queries)).toMatchObject({
      status: 'sent',
      message_id: 'wamid.1',
      channel: 'buttons',
    });
  });

  it('sends the approved template with button payloads once the window has closed', async () => {
    const { db, queries } = fakeDb({
      candidates: [candidate],
      tables: baseTables({
        message_templates: [
          {
            account_id: ACCOUNT,
            name: 'showcase_view_checkin',
            status: 'APPROVED',
            category: 'Utility',
            language: 'en_US',
          },
        ],
      }),
    });
    await processShowcaseViewNudges(db);
    const args = h.send.mock.calls[0][0];
    expect(args.kind).toBe('template');
    expect(args.templateParams).toEqual(['Ravi', '3 BHK in Kondapur']);
    expect(args.messageParams.buttonParams).toEqual({
      0: `svn_v:${PROPERTY}`,
      1: `svn_c:${PROPERTY}`,
      2: `svn_n:${PROPERTY}`,
    });
    expect(nudgeUpdate(queries)).toMatchObject({
      status: 'sent',
      channel: 'template',
    });
  });

  it('sends the Utility follow-up template naming the brokerage and the listing', async () => {
    const { db } = fakeDb({
      candidates: [candidate],
      tables: baseTables({
        accounts: [{ id: ACCOUNT, name: 'Aryavarta Ventures' }],
        message_templates: [
          {
            account_id: ACCOUNT,
            name: 'showcase_view_followup',
            status: 'APPROVED',
            category: 'Utility',
            language: 'en_US',
          },
        ],
      }),
    });
    await processShowcaseViewNudges(db);
    const args = h.send.mock.calls[0][0];
    expect(args.templateName).toBe('showcase_view_followup');
    expect(args.templateParams).toEqual([
      'Ravi',
      'Aryavarta Ventures',
      '3 BHK in Kondapur',
    ]);
    expect(args.messageParams.body).toEqual(args.templateParams);
    expect(args.text).toContain(
      'this is a follow-up on the listing Aryavarta Ventures shared with you'
    );
    expect(args.text).toContain('Property: 3 BHK in Kondapur');
    expect(h.submit).not.toHaveBeenCalled();
  });

  it('retries rather than sending under the product name when the brokerage cannot be read', async () => {
    const { db, queries } = fakeDb({
      candidates: [candidate],
      failSelect: 'accounts',
      tables: baseTables(),
    });
    await processShowcaseViewNudges(db);
    expect(h.send).not.toHaveBeenCalled();
    expect(nudgeUpdate(queries)).toEqual({ status: 'failed' });
  });

  it('submits the template once and releases the claim while it awaits approval, so the visitor is asked once it is approved', async () => {
    const { db, queries } = fakeDb({
      candidates: [candidate],
      tables: baseTables({
        whatsapp_config: [
          {
            account_id: ACCOUNT,
            user_id: OWNER,
            waba_id: 'waba',
            access_token: 'enc',
            integration_type: 'cloud',
          },
        ],
        accounts: [{ id: ACCOUNT, owner_user_id: OWNER }],
      }),
    });
    h.submit.mockResolvedValue({
      id: 'meta-1',
      status: 'PENDING',
      category: 'MARKETING',
    });
    const totals = await processShowcaseViewNudges(db);
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(
      (
        queries.find(
          (q) => q.table === 'message_templates' && q.op === 'insert'
        )?.payload as { category: string }
      ).category
    ).toBe('Marketing');
    expect(h.send).not.toHaveBeenCalled();
    expect(totals.skipped).toBe(1);
    expect(nudgeUpdate(queries)).toBeUndefined();
    expect(
      queries.find(
        (q) => q.table === 'showcase_view_nudges' && q.op === 'delete'
      )?.filters
    ).toEqual({ id: 'nudge-1', account_id: ACCOUNT });
  });

  it('retries marking a delivered check-in so a database blip cannot send it twice', async () => {
    h.conversation = {
      last_customer_message_at: new Date(
        Date.now() - 3 * 60 * 60 * 1000
      ).toISOString(),
    };
    const { db, queries } = fakeDb({
      candidates: [candidate],
      failUpdates: 2,
      tables: baseTables(),
    });
    expect((await processShowcaseViewNudges(db)).sent).toBe(1);
    const marks = queries.filter(
      (q) => q.table === 'showcase_view_nudges' && q.op === 'update'
    );
    expect(marks).toHaveLength(3);
    expect(marks[2].payload).toMatchObject({ status: 'sent' });
  });

  it('skips a visitor an agent has written to since the batch was read', async () => {
    h.conversation = { last_customer_message_at: null };
    h.conversationId = 'conv-1';
    const { db, queries } = fakeDb({
      candidates: [candidate],
      tables: baseTables({
        messages: [
          {
            id: 'm1',
            account_id: ACCOUNT,
            conversation_id: 'conv-1',
            sender_type: 'agent',
          },
        ],
      }),
    });
    await processShowcaseViewNudges(db);
    expect(h.send).not.toHaveBeenCalled();
    expect(nudgeUpdate(queries)).toEqual({
      status: 'skipped',
      skip_reason: 'agent_in_touch',
    });
  });

  it('retries rather than skips when the WhatsApp config cannot be read', async () => {
    const { db, queries } = fakeDb({
      candidates: [candidate],
      failSelect: 'whatsapp_config',
      tables: baseTables(),
    });
    expect((await processShowcaseViewNudges(db)).failed).toBe(1);
    expect(h.send).not.toHaveBeenCalled();
    expect(nudgeUpdate(queries)).toEqual({ status: 'failed' });
  });

  it('marks a check-in Meta accepted as sent even when saving the message failed, so it is not sent twice', async () => {
    h.conversation = {
      last_customer_message_at: new Date(
        Date.now() - 3 * 60 * 60 * 1000
      ).toISOString(),
    };
    h.send.mockResolvedValueOnce({
      success: false,
      reachedMeta: true,
      error: 'persist failed',
    });
    const { db, queries } = fakeDb({
      candidates: [candidate],
      tables: baseTables(),
    });
    expect((await processShowcaseViewNudges(db)).sent).toBe(1);
    expect(nudgeUpdate(queries)).toMatchObject({ status: 'sent' });
  });

  it('releases the claim without spending an attempt when the conversation lease is busy', async () => {
    h.lease = 'busy';
    const { db, queries } = fakeDb({
      candidates: [candidate],
      tables: baseTables(),
    });
    await processShowcaseViewNudges(db);
    expect(h.send).not.toHaveBeenCalled();
    expect(nudgeUpdate(queries)).toBeUndefined();
    expect(
      queries.some(
        (q) => q.table === 'showcase_view_nudges' && q.op === 'delete'
      )
    ).toBe(true);
  });

  it.each([
    ['contact_dead', { is_dead: true }, {}],
    ['contact_archived', { is_archived: true }, {}],
    ['chain_only', { chain_only: true }, {}],
    ['trade_contact', { classification: 'Agent' }, {}],
    ['listing_owner', {}, { owner_contact_id: CONTACT }],
  ])(
    'skips a visitor who became ineligible (%s) after the batch was read',
    async (reason, contactPatch, propertyPatch) => {
      const t = baseTables();
      t.contacts[0] = { ...t.contacts[0], ...contactPatch };
      t.properties[0] = { ...t.properties[0], ...propertyPatch };
      const { db, queries } = fakeDb({ candidates: [candidate], tables: t });
      await processShowcaseViewNudges(db);
      expect(h.send).not.toHaveBeenCalled();
      expect(nudgeUpdate(queries)).toEqual({
        status: 'skipped',
        skip_reason: reason,
      });
    }
  );

  it('releases the claim, sending nothing, when the visitor is browsing again', async () => {
    const { db, queries } = fakeDb({
      candidates: [candidate],
      tables: baseTables({
        showcase_events: [
          { id: 'e1', account_id: ACCOUNT, contact_id: CONTACT },
        ],
      }),
    });
    await processShowcaseViewNudges(db);
    expect(h.send).not.toHaveBeenCalled();
    expect(
      queries.some(
        (q) => q.table === 'showcase_view_nudges' && q.op === 'delete'
      )
    ).toBe(true);
  });

  it('skips a visitor who has written in since the view', async () => {
    h.conversation = {
      last_customer_message_at: new Date().toISOString(),
    };
    const { db, queries } = fakeDb({
      candidates: [candidate],
      tables: baseTables(),
    });
    await processShowcaseViewNudges(db);
    expect(h.send).not.toHaveBeenCalled();
    expect(nudgeUpdate(queries)).toEqual({
      status: 'skipped',
      skip_reason: 'replied_since_view',
    });
  });

  it('marks a failed send for retry and sends nothing when the claim is lost', async () => {
    h.conversation = {
      last_customer_message_at: new Date(
        Date.now() - 3 * 60 * 60 * 1000
      ).toISOString(),
    };
    h.send.mockResolvedValueOnce({ success: false, error: 'boom' });
    const failed = fakeDb({ candidates: [candidate], tables: baseTables() });
    expect((await processShowcaseViewNudges(failed.db)).failed).toBe(1);
    expect(nudgeUpdate(failed.queries)).toEqual({ status: 'failed' });

    h.send.mockClear();
    const lost = fakeDb({
      candidates: [candidate],
      claimId: null,
      tables: baseTables(),
    });
    await processShowcaseViewNudges(lost.db);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe('[PLS-007] answers to the showcase view check-in', () => {
  const reply = (db: never, choice: 'v' | 'c' | 'n', property = PROPERTY) =>
    handleViewNudgeReply({
      db,
      accountId: ACCOUNT,
      configOwnerUserId: OWNER,
      contact: { id: CONTACT, name: 'Ravi Teja', phone: '919000000001' },
      conversationId: 'conv-1',
      replyId: `svn_${choice}:${property}`,
    });

  it('Call me back acknowledges, records the answer, adds an urgent to-do and alerts the assigned agent', async () => {
    const { db, queries } = fakeDb({
      tables: baseTables({
        showcase_view_nudges: [
          {
            id: 'nudge-1',
            account_id: ACCOUNT,
            contact_id: CONTACT,
            property_id: PROPERTY,
            response: null,
          },
        ],
      }),
    });
    expect(await reply(db, 'c')).toBe(true);
    expect(h.send.mock.calls[0][0].text).toContain('Sharan will call you back');
    expect(
      queries.find(
        (q) => q.table === 'showcase_view_nudges' && q.op === 'update'
      )?.payload
    ).toMatchObject({ response: 'callback' });
    const todo = queries.find((q) => q.table === 'todos')?.payload as Row;
    expect(todo).toMatchObject({
      account_id: ACCOUNT,
      assigned_to: AGENT,
      contact_id: CONTACT,
      priority: 'high',
    });
    expect(
      new Date(todo.due_date as string).getTime() - Date.now()
    ).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(
      queries.find((q) => q.table === 'listing_feedback')?.payload
    ).toMatchObject({ verdict: 'interested', property_id: PROPERTY });
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: AGENT,
        eventKey: 'showcase_viewer_response',
        entityType: 'conversation',
        entityId: 'conv-1',
      })
    );
  });

  it('Book a visit falls back to the listing manager when nobody is assigned', async () => {
    const tables = baseTables();
    tables.contacts[0].assigned_agent_id = null;
    const { db, queries } = fakeDb({ tables });
    expect(await reply(db, 'v')).toBe(true);
    expect(h.notify.mock.calls[0][0].userId).toBe('lister-user');
    expect(h.notify.mock.calls[0][0].title).toContain('wants to visit');
    expect(
      (queries.find((q) => q.table === 'todos')?.payload as Row).title
    ).toContain('site visit');
  });

  it('a repeated tap is acknowledged without a second to-do or alert', async () => {
    const { db, queries } = fakeDb({
      tables: baseTables({
        showcase_view_nudges: [
          {
            id: 'nudge-1',
            account_id: ACCOUNT,
            contact_id: CONTACT,
            property_id: PROPERTY,
            response: 'callback',
          },
        ],
      }),
    });
    expect(await reply(db, 'c')).toBe(true);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(queries.some((q) => q.table === 'todos')).toBe(false);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('Not for me hands over to the listing-feedback reason list without alerting anyone', async () => {
    const { db } = fakeDb({ tables: baseTables() });
    expect(await reply(db, 'n')).toBe(true);
    expect(h.listingFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ replyId: `lfb_n_${PROPERTY}` })
    );
    expect(h.notify).not.toHaveBeenCalled();
  });

  const openNudge = () =>
    baseTables({
      showcase_view_nudges: [
        {
          id: 'nudge-1',
          account_id: ACCOUNT,
          contact_id: CONTACT,
          property_id: PROPERTY,
          response: null,
        },
      ],
    });
  const responseRecorded = (queries: Query[]) =>
    queries.some(
      (q) => q.table === 'showcase_view_nudges' && q.op === 'update'
    );

  it('records the answer only after the to-do is written, so a failed to-do is retried on the next tap', async () => {
    const { db, queries } = fakeDb({
      tables: openNudge(),
      failInsert: 'todos',
    });
    expect(await reply(db, 'c')).toBe(true);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(responseRecorded(queries)).toBe(false);
    const order = queries.map((q) => `${q.table}:${q.op}`);
    const ok = fakeDb({ tables: openNudge() });
    await reply(ok.db, 'c');
    const okOrder = ok.queries.map((q) => `${q.table}:${q.op}`);
    expect(okOrder.indexOf('showcase_view_nudges:update')).toBeGreaterThan(
      okOrder.indexOf('todos:insert')
    );
    expect(order).toContain('todos:insert');
  });

  it('rewrites a failed interest verdict on the next tap without a second to-do or alert', async () => {
    const first = fakeDb({
      tables: openNudge(),
      failInsert: 'listing_feedback',
    });
    expect(await reply(first.db, 'v')).toBe(true);
    expect(first.queries.some((q) => q.table === 'todos')).toBe(true);
    expect(responseRecorded(first.queries)).toBe(true);

    h.notify.mockClear();
    const tables = openNudge();
    tables.showcase_view_nudges[0].response = 'visit';
    const again = fakeDb({ tables });
    expect(await reply(again.db, 'v')).toBe(true);
    expect(
      again.queries.find((q) => q.table === 'listing_feedback')?.payload
    ).toMatchObject({ verdict: 'interested' });
    expect(again.queries.some((q) => q.table === 'todos')).toBe(false);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('answers a tap on a listing now pending review without promising a visit or call', async () => {
    const tables = openNudge();
    tables.properties[0].status = 'Pending Review';
    const { db, queries } = fakeDb({ tables });
    expect(await reply(db, 'c')).toBe(true);
    expect(h.send.mock.calls[0][0].text).toContain("isn't open for visits");
    expect(queries.some((q) => q.table === 'todos')).toBe(false);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('still alerts the agent and adds the to-do when the buyer acknowledgement fails, and says so', async () => {
    h.send.mockResolvedValueOnce({ success: false, error: 'meta down' });
    const { db, queries } = fakeDb({ tables: openNudge() });
    expect(await reply(db, 'v')).toBe(true);
    expect(queries.some((q) => q.table === 'todos')).toBe(true);
    expect(h.notify.mock.calls[0][0].body).toContain(
      "confirmation to them didn't go through"
    );
    expect(responseRecorded(queries)).toBe(true);
  });

  it('records Not for me only once the reason list was sent', async () => {
    h.listingFeedback.mockResolvedValueOnce(false);
    const failed = fakeDb({ tables: openNudge() });
    expect(await reply(failed.db, 'n')).toBe(false);
    expect(responseRecorded(failed.queries)).toBe(false);
    const sent = fakeDb({ tables: openNudge() });
    expect(await reply(sent.db, 'n')).toBe(true);
    expect(responseRecorded(sent.queries)).toBe(true);
  });

  it('answers a visit or call-back tap on a listing that has since sold with its status, promising nothing', async () => {
    const tables = openNudge();
    tables.properties[0].status = 'Sold';
    const { db, queries } = fakeDb({ tables });
    expect(await reply(db, 'v')).toBe(true);
    expect(h.send.mock.calls[0][0].text).toBe('Sorry, this one has been sold.');
    expect(queries.some((q) => q.table === 'todos')).toBe(false);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('alerts the listing manager when the unavailable-listing reply cannot be sent', async () => {
    h.send.mockResolvedValueOnce({ success: false, error: 'meta down' });
    const tables = openNudge();
    tables.properties[0].status = 'Sold';
    const { db, queries } = fakeDb({ tables });
    expect(await reply(db, 'c')).toBe(true);
    expect(queries.some((q) => q.table === 'todos')).toBe(false);
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'lister-user',
        title: expect.stringContaining('Sold'),
      })
    );
  });

  it('ignores a tap naming a property outside the account', async () => {
    const { db } = fakeDb({ tables: baseTables() });
    expect(await reply(db, 'c', '99999999-2222-4333-8444-555555555555')).toBe(
      false
    );
    expect(h.send).not.toHaveBeenCalled();
  });
});
