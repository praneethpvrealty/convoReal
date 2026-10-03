import { beforeEach, describe, it, expect, vi } from 'vitest';

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  send: vi.fn(),
  lease: 'run' as 'run' | 'busy' | 'lookup_failed',
  beforeRun: null as (() => void) | null,
  leased: [] as string[],
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) => h.send(...args),
}));

vi.mock('@/lib/conversations/outbound-lease', () => ({
  withContactConversationLease: async (
    _db: unknown,
    _accountId: string,
    contactId: string,
    run: () => Promise<unknown>
  ) => {
    h.leased.push(contactId);
    if (h.lease !== 'run') return { status: h.lease };
    h.beforeRun?.();
    return { status: 'ran', value: await run() };
  },
}));

import {
  findFeedbackSharePropertyId,
  processShareFeedbackFollowups,
  SHARE_FEEDBACK_CLAIM_STALE_MS,
} from './share-feedback';

const ACCOUNT_ID = 'acc-1';
const CONTACT_ID = 'contact-1';
const SHARE_ID = 'share-1';
const PROPERTY_ID = '11111111-2222-4333-8444-555555555555';
const SHARE_CREATED_AT = new Date(Date.now() - 45 * 60 * 1000).toISOString();

function splitTopLevel(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function matchesClause(row: Row, clause: string): boolean {
  if (clause.startsWith('and(')) {
    return splitTopLevel(clause.slice(4, -1)).every((c) =>
      matchesClause(row, c)
    );
  }
  const [column, ...rest] = clause.split('.');
  const filter = rest.join('.');
  const cell = row[column];
  if (filter === 'is.null') return cell == null;
  if (filter === 'not.is.null') return cell != null;
  const [op, ...valueParts] = filter.split('.');
  const value = valueParts.join('.');
  if (cell == null) return false;
  if (op === 'lt') return String(cell) < value;
  if (op === 'gte') return String(cell) >= value;
  if (op === 'neq') return String(cell) !== value;
  return false;
}

function matchesOr(row: Row, expr: string): boolean {
  return splitTopLevel(expr).some((clause) => matchesClause(row, clause));
}

function makeDb(
  opts: {
    lastCustomerMessageAt?: string | null;
    share?: Row;
    property?: Row | null;
    propertyError?: boolean;
    failMarks?: number;
    contactLanguage?: string | null;
    accountLanguage?: string | null;
  } = {}
) {
  const state = {
    failMarks: opts.failMarks ?? 0,
    lastCustomerMessageAt: opts.lastCustomerMessageAt,
    shares: [
      {
        id: SHARE_ID,
        account_id: ACCOUNT_ID,
        contact_id: CONTACT_ID,
        property_id: PROPERTY_ID,
        created_at: SHARE_CREATED_AT,
        recipient_kind: 'buyer',
        feedback_status: 'pending',
        feedback_sent_at: null,
        contacts: { id: CONTACT_ID, name: 'Asha' },
        ...opts.share,
      } as Row,
    ],
  };

  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    const ors: string[] = [];
    const lowerBounds: [string, string][] = [];
    let patch: Row | null = null;
    const applyPatch = () => {
      const rows = state.shares.filter(
        (r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v) &&
          ors.every((expr) => matchesOr(r, expr))
      );
      for (const r of rows) Object.assign(r, patch);
      return rows;
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return b;
      },
      or: (expr: string) => {
        ors.push(expr);
        return b;
      },
      in: () => b,
      lte: () => b,
      gte: (column: string, value: string) => {
        lowerBounds.push([column, value]);
        return b;
      },
      order: () => b,
      limit: () => b,
      update: (payload: Row) => {
        patch = payload;
        return b;
      },
      maybeSingle: async () => {
        if (table === 'property_shares' && patch) {
          const rows = applyPatch();
          return { data: rows[0] ? { id: rows[0].id } : null, error: null };
        }
        if (table === 'properties') {
          return opts.propertyError
            ? { data: null, error: { message: 'timeout' } }
            : { data: opts.property ?? null, error: null };
        }
        if (table === 'accounts') {
          return {
            data: { default_language: opts.accountLanguage ?? null },
            error: null,
          };
        }
        if (table === 'conversations') {
          return {
            data:
              state.lastCustomerMessageAt === undefined
                ? null
                : { last_customer_message_at: state.lastCustomerMessageAt },
            error: null,
          };
        }
        if (table === 'whatsapp_config') {
          return { data: { user_id: 'owner-1' }, error: null };
        }
        if (table === 'contacts') {
          return {
            data: {
              name: 'Asha',
              preferred_language:
                opts.contactLanguage === undefined
                  ? 'en'
                  : opts.contactLanguage,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
        if (table === 'property_shares') {
          if (patch?.feedback_status === 'sent' && state.failMarks > 0) {
            state.failMarks--;
            return Promise.resolve({
              data: null,
              error: { message: 'connection reset' },
            }).then(resolve);
          }
          if (patch) {
            applyPatch();
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          return Promise.resolve({
            data: state.shares
              .filter(
                (r) =>
                  r.feedback_status === 'pending' &&
                  lowerBounds.every(([c, v]) => String(r[c]) >= v) &&
                  ors.every((expr) => matchesOr(r, expr))
              )
              .map((r) => ({ ...r })),
            error: null,
          }).then(resolve);
        }
        if (table === 'message_templates') {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return b;
  }

  return { from: (table: string) => builder(table), state };
}

beforeEach(() => {
  h.send.mockReset();
  h.send.mockResolvedValue({
    success: true,
    whatsappMessageId: 'wamid.prompt',
  });
  h.lease = 'run';
  h.beforeRun = null;
  h.leased = [];
});

describe('processShareFeedbackFollowups', () => {
  it('never queries messages.contact_id/direction and sends when the buyer never replied', async () => {
    const db = makeDb({ lastCustomerMessageAt: null });

    const sent = await processShareFeedbackFollowups(db as never);

    expect(sent).toBe(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(db.state.shares[0].feedback_status).toBe('sent');
    expect(db.state.shares[0].feedback_message_id).toBe('wamid.prompt');
  });

  it('[INB-022] stores the rendered template body so the inbox bubble is not blank', async () => {
    const db = makeDb({ lastCustomerMessageAt: null });

    await processShareFeedbackFollowups(db as never);

    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'template',
        templateParams: ['Asha'],
        text: 'Hi Asha, following up on the property I shared earlier.\n\nDid it match what you are looking for?',
      })
    );
  });

  it('[INB-022] retries recording the prompt id when the first write fails', async () => {
    const db = makeDb({ lastCustomerMessageAt: null, failMarks: 1 });

    expect(await processShareFeedbackFollowups(db as never)).toBe(1);

    expect(db.state.shares[0]).toMatchObject({
      feedback_status: 'sent',
      feedback_message_id: 'wamid.prompt',
    });
  });

  it('[INB-022] names the shared property and asks with tappable buttons while the window is open', async () => {
    const db = makeDb({
      lastCustomerMessageAt: new Date(
        Date.now() - 2 * 60 * 60 * 1000
      ).toISOString(),
      property: {
        id: PROPERTY_ID,
        title: '35x80 Commercial Corner Plot on Kolar Main Road',
      },
    });

    expect(await processShareFeedbackFollowups(db as never)).toBe(1);

    const sent = h.send.mock.calls[0][0];
    expect(sent).toMatchObject({
      kind: 'interactive',
      interactiveType: 'buttons',
    });
    expect(sent.interactiveBody).toBe(
      'Hi Asha, following up on *35x80 Commercial Corner Plot on Kolar Main Road*, which I shared earlier.\n\nDid it match what you are looking for?'
    );
    expect(sent.interactiveButtons).toEqual([
      { id: `lfb_y_${PROPERTY_ID}`, title: "It's perfect" },
      { id: `lfb_n_${PROPERTY_ID}`, title: 'Not interested' },
      { id: 'lfb_form', title: 'Update preferences' },
    ]);
    expect(db.state.shares[0].feedback_status).toBe('sent');
  });

  it('[INB-022] retries rather than sending the generic template when the property lookup fails', async () => {
    const db = makeDb({
      lastCustomerMessageAt: new Date(
        Date.now() - 2 * 60 * 60 * 1000
      ).toISOString(),
      propertyError: true,
    });

    expect(await processShareFeedbackFollowups(db as never)).toBe(0);

    expect(h.send).not.toHaveBeenCalled();
    expect(db.state.shares[0]).toMatchObject({
      feedback_status: 'pending',
      feedback_sent_at: null,
    });
  });

  it('[INB-022] sends the localized template to a buyer who inherits a non-English account language', async () => {
    const db = makeDb({
      lastCustomerMessageAt: new Date(
        Date.now() - 2 * 60 * 60 * 1000
      ).toISOString(),
      property: { id: PROPERTY_ID, title: '35x80 Commercial Corner Plot' },
      contactLanguage: null,
      accountLanguage: 'kn',
    });

    await processShareFeedbackFollowups(db as never);

    expect(h.send.mock.calls[0][0]).toMatchObject({ kind: 'template' });
  });

  it('[INB-022] falls back to the template once the 24-hour window has closed', async () => {
    const db = makeDb({
      lastCustomerMessageAt: new Date(
        Date.now() - 30 * 60 * 60 * 1000
      ).toISOString(),
      property: { id: PROPERTY_ID, title: '35x80 Commercial Corner Plot' },
    });

    await processShareFeedbackFollowups(db as never);

    expect(h.send.mock.calls[0][0]).toMatchObject({
      kind: 'template',
      templateName: 'property_share_feedback',
    });
  });

  it('skips the share once the buyer has replied since it was created', async () => {
    const db = makeDb({
      lastCustomerMessageAt: new Date(
        Date.now() - 10 * 60 * 1000
      ).toISOString(),
    });

    const sent = await processShareFeedbackFollowups(db as never);

    expect(sent).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(db.state.shares[0]).toMatchObject({
      feedback_status: 'skipped',
      feedback_sent_at: null,
    });
  });

  it('[INB-018] sends under the buyer conversation lease', async () => {
    const db = makeDb({ lastCustomerMessageAt: null });

    await processShareFeedbackFollowups(db as never);

    expect(h.leased).toEqual([CONTACT_ID]);
  });

  it('[INB-018] a busy conversation leaves the share pending and unclaimed for the next run', async () => {
    h.lease = 'busy';
    const db = makeDb({ lastCustomerMessageAt: null });

    const sent = await processShareFeedbackFollowups(db as never);

    expect(sent).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(db.state.shares[0]).toMatchObject({
      feedback_status: 'pending',
      feedback_sent_at: null,
    });

    h.lease = 'run';
    expect(await processShareFeedbackFollowups(db as never)).toBe(1);
  });

  it('[INB-018] a failed conversation lookup releases the share instead of sending unlocked', async () => {
    h.lease = 'lookup_failed';
    const db = makeDb({ lastCustomerMessageAt: null });

    expect(await processShareFeedbackFollowups(db as never)).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(db.state.shares[0].feedback_sent_at).toBeNull();
  });

  it('[INB-018] a reply that lands while it waits for the lease skips the share', async () => {
    const db = makeDb({ lastCustomerMessageAt: null });
    h.beforeRun = () => {
      db.state.lastCustomerMessageAt = new Date().toISOString();
    };

    const sent = await processShareFeedbackFollowups(db as never);

    expect(sent).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(db.state.shares[0].feedback_status).toBe('skipped');
  });

  it('[INB-018] a share another run has claimed is not sent twice', async () => {
    const db = makeDb({
      lastCustomerMessageAt: null,
      share: { feedback_sent_at: new Date().toISOString() },
    });

    const sent = await processShareFeedbackFollowups(db as never);

    expect(sent).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.leased).toEqual([]);
  });

  it('[INB-018] a claim left by a run that died is taken over once it is stale', async () => {
    const db = makeDb({
      lastCustomerMessageAt: null,
      share: {
        feedback_sent_at: new Date(
          Date.now() - SHARE_FEEDBACK_CLAIM_STALE_MS - 60_000
        ).toISOString(),
      },
    });

    expect(await processShareFeedbackFollowups(db as never)).toBe(1);
  });

  it('[INB-018] a claim left late in the send window is still taken over once stale', async () => {
    const db = makeDb({
      lastCustomerMessageAt: null,
      share: {
        created_at: new Date(
          Date.now() - 2 * 60 * 60 * 1000 - 20 * 60 * 1000
        ).toISOString(),
        feedback_sent_at: new Date(
          Date.now() - SHARE_FEEDBACK_CLAIM_STALE_MS - 60_000
        ).toISOString(),
      },
    });

    expect(await processShareFeedbackFollowups(db as never)).toBe(1);
  });

  it('[INB-018] an unclaimed share past the send window is left alone', async () => {
    const db = makeDb({
      lastCustomerMessageAt: null,
      share: {
        created_at: new Date(
          Date.now() - 2 * 60 * 60 * 1000 - 20 * 60 * 1000
        ).toISOString(),
      },
    });

    expect(await processShareFeedbackFollowups(db as never)).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('[INB-018] a send Meta refuses releases the share rather than marking it sent', async () => {
    h.send.mockResolvedValue({ success: false, error: 'rate limited' });
    const db = makeDb({ lastCustomerMessageAt: null });

    expect(await processShareFeedbackFollowups(db as never)).toBe(0);
    expect(db.state.shares[0]).toMatchObject({
      feedback_status: 'pending',
      feedback_sent_at: null,
    });
  });
});

describe('findFeedbackSharePropertyId', () => {
  function lookupDb(rows: Row[], failOr = false) {
    const calls: [string, unknown][] = [];
    const tables: string[] = [];
    return {
      calls,
      tables,
      from(table: string) {
        tables.push(table);
        const ors: string[] = [];
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'limit']) {
          b[m] = (col: string, val: unknown) => {
            calls.push([`${m}:${col}`, val]);
            return b;
          };
        }
        b.or = (expr: string) => {
          ors.push(expr);
          return b;
        };
        b.maybeSingle = async () => {
          if (failOr && ors.length > 0) {
            return { data: null, error: { message: 'timeout' } };
          }
          const hit = rows.filter((row) =>
            ors.every((expr) => matchesOr(row, expr))
          );
          return { data: hit[0] ?? null, error: null };
        };
        return b;
      },
    };
  }

  it('[INB-022] resolves the share by the exact prompt message the tap replied to', async () => {
    const db = lookupDb([{ property_id: PROPERTY_ID }]);

    expect(
      await findFeedbackSharePropertyId(
        db as never,
        ACCOUNT_ID,
        CONTACT_ID,
        'wamid.prompt'
      )
    ).toBe(PROPERTY_ID);
    expect(db.calls).toEqual(
      expect.arrayContaining([
        ['eq:account_id', ACCOUNT_ID],
        ['eq:contact_id', CONTACT_ID],
        ['eq:feedback_message_id', 'wamid.prompt'],
      ])
    );
  });

  it('[INB-022] refuses to pick when one prompt covers shares of different properties', async () => {
    const db = lookupDb([
      ...Array.from({ length: 25 }, () => ({ property_id: PROPERTY_ID })),
      { property_id: '99999999-2222-4333-8444-555555555555' },
    ]);
    expect(
      await findFeedbackSharePropertyId(
        db as never,
        ACCOUNT_ID,
        CONTACT_ID,
        'wamid.prompt'
      )
    ).toBeNull();
  });

  it('[INB-022] resolves nothing when the ambiguity check fails', async () => {
    const db = lookupDb(
      [
        { property_id: PROPERTY_ID },
        { property_id: '99999999-2222-4333-8444-555555555555' },
      ],
      true
    );
    expect(
      await findFeedbackSharePropertyId(
        db as never,
        ACCOUNT_ID,
        CONTACT_ID,
        'wamid.prompt'
      )
    ).toBeNull();
  });

  it('[INB-022] still resolves when every share on the prompt is the same property', async () => {
    const db = lookupDb([
      { property_id: PROPERTY_ID },
      { property_id: PROPERTY_ID },
    ]);
    expect(
      await findFeedbackSharePropertyId(
        db as never,
        ACCOUNT_ID,
        CONTACT_ID,
        'wamid.prompt'
      )
    ).toBe(PROPERTY_ID);
  });

  it('[INB-022] never guesses a property when the tap carries no prompt id', async () => {
    const db = lookupDb([{ property_id: PROPERTY_ID }]);
    expect(
      await findFeedbackSharePropertyId(
        db as never,
        ACCOUNT_ID,
        CONTACT_ID,
        null
      )
    ).toBeNull();
    expect(db.tables).toEqual([]);
  });
});
