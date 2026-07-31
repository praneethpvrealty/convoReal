import { describe, it, expect, vi, beforeEach } from 'vitest';

// End-to-end drive of the consent state machine with the WhatsApp
// transport captured and an in-memory stand-in for the four tables the
// module touches. Complements location-requests.test.ts (pure builders)
// and the rolled-back SQL run that validated the real schema: this file
// proves the module functions wire the hops, acks, masks and terminal
// messages together correctly.

interface SentMessage {
  accountId: string;
  contactId?: string | null;
  toPhone?: string | null;
  kind: string;
  text?: string | null;
  interactiveBody?: string | null;
  interactiveButtons?: Array<{ id: string; title: string }> | null;
}

const sent: SentMessage[] = [];

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(async (args: SentMessage) => {
    sent.push(args);
    return { success: true, messageId: `m-${sent.length}` };
  }),
}));

import {
  requestConsentFromContact,
  handleLocationConsentReply,
  approveRequestAndSendReveal,
  closeRequestWithRedirect,
  sweepConsentTimeouts,
  resolveNextIntermediary,
  CONSENT_APPROVE_PREFIX,
  CONSENT_DECLINE_PREFIX,
  type LocationRequestRow,
} from './location-requests';

// ── Minimal in-memory supabase stand-in ─────────────────────────
type Row = Record<string, unknown>;

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'update' | 'insert' = 'select';
  private patch: Row | null = null;
  private inserted: Row[] | null = null;
  private max: number | null = null;

  constructor(
    private tables: Record<string, Row[]>,
    private table: string
  ) {}

  select() {
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.inserted = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.patch = patch;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  not(col: string, op: string, val: unknown) {
    if (op === 'is' && val === null) {
      this.filters.push((r) => r[col] !== null && r[col] !== undefined);
    }
    return this;
  }
  lt(col: string, val: string) {
    this.filters.push(
      (r) => typeof r[col] === 'string' && (r[col] as string) < val
    );
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }

  private matching(): Row[] {
    let rows = (this.tables[this.table] || []).filter((r) =>
      this.filters.every((f) => f(r))
    );
    if (this.max !== null) rows = rows.slice(0, this.max);
    return rows;
  }

  private run(): { data: Row[] | null; error: null } {
    if (this.op === 'update') {
      for (const row of this.matching()) Object.assign(row, this.patch);
      return { data: null, error: null };
    }
    if (this.op === 'insert') {
      const withIds = (this.inserted || []).map((r) => ({
        id: `row-${Math.random().toString(36).slice(2, 10)}`,
        ...r,
      }));
      this.tables[this.table] = [
        ...(this.tables[this.table] || []),
        ...withIds,
      ];
      return { data: structuredClone(withIds), error: null };
    }
    // Detached copies, like the real client: rows fetched before an
    // update must not observe it.
    return { data: structuredClone(this.matching()), error: null };
  }

  async maybeSingle() {
    const { data } = this.run();
    return { data: data?.[0] ?? null, error: null };
  }
  async single() {
    const { data } = this.run();
    return {
      data: data?.[0] ?? null,
      error: data?.[0] ? null : { message: 'no row' },
    };
  }
  then(
    resolve: (v: { data: Row[] | null; error: null }) => void,
    reject?: (e: unknown) => void
  ) {
    try {
      resolve(this.run());
    } catch (e) {
      reject?.(e);
    }
  }
}

function fakeAdmin(tables: Record<string, Row[]>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => new FakeQuery(tables, table) } as any;
}

// ── Fixture: listing account → co-broker B → co-broker C → seeker ──
const ACCOUNT = 'acct-1';
const PROPERTY = 'prop-1';
const OWNER_USER = 'user-owner';
const B = 'contact-b';
const C = 'contact-c';

function freshTables(): Record<string, Row[]> {
  return {
    accounts: [{ id: ACCOUNT, owner_user_id: OWNER_USER }],
    profiles: [
      { user_id: OWNER_USER, account_id: ACCOUNT, email: 'owner@agency.test' },
    ],
    properties: [
      {
        id: PROPERTY,
        account_id: ACCOUNT,
        user_id: OWNER_USER,
        title: 'E2E Guarded House',
        property_code: 'PROP-9',
      },
    ],
    contacts: [
      {
        id: B,
        account_id: ACCOUNT,
        name: 'Broker B',
        phone: '+919800000001',
        classification: 'Agent',
        email: null,
      },
      {
        id: C,
        account_id: ACCOUNT,
        name: 'Broker C',
        phone: '+919800000002',
        classification: 'Agent',
        email: null,
      },
      {
        id: 'contact-owner',
        account_id: ACCOUNT,
        name: 'Owner Self',
        phone: '+919800000000',
        classification: 'Agent',
        email: 'owner@agency.test',
      },
    ],
    property_reshare_links: [
      {
        id: 'rs-b',
        account_id: ACCOUNT,
        property_id: PROPERTY,
        contact_id: B,
        parent_contact_id: null,
      },
      {
        id: 'rs-c',
        account_id: ACCOUNT,
        property_id: PROPERTY,
        contact_id: C,
        parent_contact_id: B,
      },
    ],
    property_location_requests: [],
  };
}

function seedRequest(
  tables: Record<string, Row[]>,
  overrides: Row = {}
): LocationRequestRow {
  const row: Row = {
    id: 'req-1',
    account_id: ACCOUNT,
    property_id: PROPERTY,
    requester_name: 'Rahul Sharma',
    requester_phone: '+919876543210',
    status: 'pending',
    via_share_id: null,
    via_contact_id: C,
    consent_chain: [],
    pending_consent_contact_id: null,
    consent_requested_at: null,
    share_token: null,
    ...overrides,
  };
  tables.property_location_requests.push(row);
  return row as unknown as LocationRequestRow;
}

beforeEach(() => {
  sent.length = 0;
});

describe('multi-hop consent flow, end to end', () => {
  it('walks seeker → C → B → owner queue → approval → reveal', async () => {
    const tables = freshTables();
    const admin = fakeAdmin(tables);
    const request = seedRequest(tables);

    // 1. Request arrives via C's link — consent ask goes to C, masked.
    const asked = await requestConsentFromContact(admin, request, C);
    expect(asked).toBe(true);
    const askC = sent.at(-1)!;
    expect(askC.contactId).toBe(C);
    expect(askC.kind).toBe('interactive');
    expect(askC.interactiveBody).toContain('Ra••• Sh•••');
    expect(askC.interactiveBody).toContain('98•••••210');
    expect(askC.interactiveBody).not.toContain('Rahul Sharma');
    expect(askC.interactiveButtons?.map((b) => b.id)).toEqual([
      `${CONSENT_APPROVE_PREFIX}req-1`,
      `${CONSENT_DECLINE_PREFIX}req-1`,
    ]);
    const row = () => tables.property_location_requests[0];
    expect(row().pending_consent_contact_id).toBe(C);

    // 2. A stranger tapping a forwarded consent message is NOT consent.
    const strangerHandled = await handleLocationConsentReply({
      admin,
      accountId: ACCOUNT,
      replyId: `${CONSENT_APPROVE_PREFIX}req-1`,
      senderPhone: '+911111111111',
    });
    expect(strangerHandled).toBe(true);
    expect(row().pending_consent_contact_id).toBe(C);
    expect(row().status).toBe('pending');

    // 3. C approves → chain records C, ask moves UP to B (not owner).
    await handleLocationConsentReply({
      admin,
      accountId: ACCOUNT,
      replyId: `${CONSENT_APPROVE_PREFIX}req-1`,
      senderPhone: '+919800000002',
    });
    expect(row().pending_consent_contact_id).toBe(B);
    const chain1 = row().consent_chain as Array<{
      contact_id: string;
      decision: string;
    }>;
    expect(chain1).toHaveLength(1);
    expect(chain1[0]).toMatchObject({ contact_id: C, decision: 'approved' });
    const askB = sent.find(
      (m) => m.contactId === B && m.kind === 'interactive'
    );
    expect(askB?.interactiveBody).toContain('Ra••• Sh•••');
    const ackC = sent.find((m) => m.contactId === C && m.kind === 'text');
    expect(ackC?.text).toContain(
      'forwarded to the agent who shared the property with you'
    );

    // 4. B approves → top of chain → owner queue, owner notified masked.
    await handleLocationConsentReply({
      admin,
      accountId: ACCOUNT,
      replyId: `${CONSENT_APPROVE_PREFIX}req-1`,
      senderPhone: '+919800000001',
    });
    expect(row().pending_consent_contact_id).toBeNull();
    const chain2 = row().consent_chain as Array<{
      contact_id: string;
      decision: string;
    }>;
    expect(chain2).toHaveLength(2);
    expect(chain2[1]).toMatchObject({ contact_id: B, decision: 'approved' });
    const ownerNotify = sent.find((m) => m.contactId === 'contact-owner');
    expect(ownerNotify?.text).toContain('Location Reveal Request');
    expect(ownerNotify?.text).toContain('Ra••• Sh•••');
    expect(ownerNotify?.text).not.toContain('Rahul Sharma');
    expect(ownerNotify?.text).not.toContain('9876543210');

    // 5. Owner approves → token minted, seeker gets the reveal link,
    //    C (the sharer the seeker came through) gets the private notice.
    const { shareLink } = await approveRequestAndSendReveal(
      admin,
      row() as unknown as LocationRequestRow,
      OWNER_USER
    );
    expect(row().status).toBe('approved');
    expect(row().share_token).toHaveLength(48);
    expect(shareLink).toContain(`/reveal/${row().share_token}`);
    const reveal = sent.find((m) => m.toPhone === '+919876543210');
    expect(reveal?.text).toContain(shareLink);
    expect(reveal?.text).toContain('48 hours');
    const notice = sent
      .filter((m) => m.contactId === C && m.kind === 'text')
      .at(-1);
    expect(notice?.text).toContain('details remain private');
  });

  it('resolveNextIntermediary walks C→B, tops out at B, and guards cycles', async () => {
    const tables = freshTables();
    const admin = fakeAdmin(tables);
    const req = { account_id: ACCOUNT, property_id: PROPERTY };

    expect(await resolveNextIntermediary(admin, req, C, [])).toBe(B);
    expect(await resolveNextIntermediary(admin, req, B, [])).toBeNull();
    // cycle guard: B already consented → never re-asked
    expect(
      await resolveNextIntermediary(admin, req, C, [{ contact_id: B }])
    ).toBeNull();
  });

  it('a decline anywhere ends the request and redirects the seeker', async () => {
    const tables = freshTables();
    const admin = fakeAdmin(tables);
    seedRequest(tables, {
      pending_consent_contact_id: C,
      consent_requested_at: new Date().toISOString(),
    });

    await handleLocationConsentReply({
      admin,
      accountId: ACCOUNT,
      replyId: `${CONSENT_DECLINE_PREFIX}req-1`,
      senderPhone: '+919800000002',
    });

    const row = tables.property_location_requests[0];
    expect(row.status).toBe('rejected');
    const redirect = sent.find((m) => m.toPhone === '+919876543210');
    expect(redirect?.text).toContain(
      'speak with the person who shared you the property details'
    );
    expect(redirect?.text).toContain('informed decision');
  });

  it('the 2-hour sweep expires stale consent asks with the same redirect', async () => {
    const tables = freshTables();
    const admin = fakeAdmin(tables);
    seedRequest(tables, {
      pending_consent_contact_id: C,
      consent_requested_at: new Date(
        Date.now() - 3 * 60 * 60 * 1000
      ).toISOString(),
    });
    seedRequest(tables, {
      id: 'req-fresh',
      pending_consent_contact_id: C,
      consent_requested_at: new Date().toISOString(),
    });

    const expired = await sweepConsentTimeouts(admin);
    expect(expired).toBe(1);
    expect(tables.property_location_requests[0].status).toBe('expired');
    expect(tables.property_location_requests[1].status).toBe('pending');
    const redirect = sent.find((m) => m.toPhone === '+919876543210');
    expect(redirect?.text).toContain(
      'speak with the person who shared you the property details'
    );
  });

  it('owner rejection uses the same seeker redirect', async () => {
    const tables = freshTables();
    const admin = fakeAdmin(tables);
    const request = seedRequest(tables, {
      consent_chain: [
        { contact_id: C, decision: 'approved', at: new Date().toISOString() },
        { contact_id: B, decision: 'approved', at: new Date().toISOString() },
      ],
    });

    await closeRequestWithRedirect(admin, request, 'rejected');
    expect(tables.property_location_requests[0].status).toBe('rejected');
    const redirect = sent.find((m) => m.toPhone === '+919876543210');
    expect(redirect?.text).toContain(
      'speak with the person who shared you the property details'
    );
  });
});
