import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  templateName?: string | null;
  messageParams?: {
    body?: string[];
    buttonParams?: Record<number, string>;
  } | null;
  interactiveBody?: string | null;
  interactiveButtons?: Array<{ id: string; title: string }> | null;
}

const sent: SentMessage[] = [];

async function defaultDispatcherImpl(args: SentMessage) {
  sent.push(args);
  return { success: true, messageId: `m-${sent.length}` };
}

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(defaultDispatcherImpl),
}));

const notified: Array<Record<string, unknown>> = [];
vi.mock('@/lib/notifications/create', () => ({
  createNotification: vi.fn(async (input: Record<string, unknown>) => {
    notified.push(input);
    return { inAppId: 'n-1', whatsapp: null, pushCount: 0 };
  }),
}));
vi.mock('@/lib/notifications/preferences', () => ({
  resolveChannels: vi.fn(async () => ({
    inApp: true,
    push: true,
    whatsapp: true,
  })),
}));

import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { CUSTOMER_WINDOW_EXPIRED_MESSAGE } from '@/lib/whatsapp/customer-window';
import {
  requestConsentFromContact,
  notifyOwnerQueue,
  handleLocationConsentReply,
  handleOwnerLocationReply,
  approveRequestAndSendReveal,
  closeRequestWithRedirect,
  sweepConsentTimeouts,
  resolveNextIntermediary,
  CONSENT_APPROVE_PREFIX,
  CONSENT_DECLINE_PREFIX,
  OWNER_APPROVE_PREFIX,
  OWNER_REJECT_PREFIX,
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

function seedApprovalTemplates(tables: Record<string, Row[]>) {
  tables.message_templates = [
    {
      id: 'tpl-consent',
      account_id: ACCOUNT,
      name: 'location_consent_request',
      status: 'APPROVED',
      language: 'en_US',
      body_text:
        'Hi {{1}}, a contact who received {{2}} through your shared link requested protected property access. Requester: {{3}}. Approve to forward this request or decline to close it.',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Approve request' },
        { type: 'QUICK_REPLY', text: 'Decline request' },
      ],
      last_submitted_at: new Date().toISOString(),
    },
    {
      id: 'tpl-owner',
      account_id: ACCOUNT,
      name: 'location_owner_decision',
      status: 'APPROVED',
      language: 'en_US',
      body_text:
        'Request: {{1}}. Property: {{2}}. Requester: {{3}}. Approve to release {{4}}, or reject to close the request.',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Approve access' },
        { type: 'QUICK_REPLY', text: 'Reject access' },
      ],
      last_submitted_at: new Date().toISOString(),
    },
  ];
}

beforeEach(() => {
  sent.length = 0;
  notified.length = 0;
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

    // 4. B approves → top of chain → owner queue: in-app notification
    //    plus a WhatsApp ping with Approve/Reject buttons, masked.
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
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({
      userId: OWNER_USER,
      type: 'location_request',
    });
    expect(notified[0].body).toContain('Ra••• Sh•••');
    expect(notified[0].body).not.toContain('Rahul Sharma');
    const ownerNotify = sent.find((m) => m.contactId === 'contact-owner');
    expect(ownerNotify?.kind).toBe('interactive');
    expect(ownerNotify?.interactiveBody).toContain('Location Reveal Request');
    expect(ownerNotify?.interactiveBody).toContain('Ra••• Sh•••');
    expect(ownerNotify?.interactiveBody).not.toContain('Rahul Sharma');
    expect(ownerNotify?.interactiveBody).not.toContain('9876543210');
    expect(ownerNotify?.interactiveButtons?.map((b) => b.id)).toEqual([
      `${OWNER_APPROVE_PREFIX}req-1`,
      `${OWNER_REJECT_PREFIX}req-1`,
    ]);

    // 5. A stranger tapping a forwarded owner button is NOT a decision.
    const strangerOwner = await handleOwnerLocationReply({
      admin,
      accountId: ACCOUNT,
      replyId: `${OWNER_APPROVE_PREFIX}req-1`,
      senderPhone: '+911111111111',
    });
    expect(strangerOwner).toBe(true);
    expect(row().status).toBe('pending');

    // 6. Owner taps Approve on WhatsApp → token minted, seeker gets the
    //    reveal link, C (the sharer the seeker came through) gets the
    //    private notice, owner gets an ack.
    await handleOwnerLocationReply({
      admin,
      accountId: ACCOUNT,
      replyId: `${OWNER_APPROVE_PREFIX}req-1`,
      senderPhone: '+919800000000',
    });
    expect(row().status).toBe('approved');
    expect(row().share_token).toHaveLength(48);
    const reveal = sent.find((m) => m.toPhone === '+919876543210');
    expect(reveal?.text).toContain(`/reveal/${row().share_token}`);
    expect(reveal?.text).toContain('48 hours');
    const notice = sent
      .filter((m) => m.contactId === C && m.kind === 'text')
      .at(-1);
    expect(notice?.text).toContain('details remain private');
    const ownerAck = sent
      .filter((m) => m.contactId === 'contact-owner' && m.kind === 'text')
      .at(-1);
    expect(ownerAck?.text).toContain('Approved');
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

describe('approval requests outside the 24-hour window', () => {
  beforeEach(() => {
    vi.mocked(sendWhatsAppMessageAndPersist).mockImplementation((async (
      args: SentMessage
    ) => {
      sent.push(args);
      if (args.kind === 'interactive') {
        return {
          success: false,
          error: CUSTOMER_WINDOW_EXPIRED_MESSAGE,
        };
      }
      return { success: true, messageId: `m-${sent.length}` };
    }) as typeof sendWhatsAppMessageAndPersist);
  });

  afterEach(() => {
    vi.mocked(sendWhatsAppMessageAndPersist).mockImplementation(
      defaultDispatcherImpl as typeof sendWhatsAppMessageAndPersist
    );
  });

  it('uses the approved consent template and stamps awaiting state only after delivery', async () => {
    const tables = freshTables();
    seedApprovalTemplates(tables);
    const admin = fakeAdmin(tables);
    const request = seedRequest(tables);

    expect(await requestConsentFromContact(admin, request, C)).toBe(true);

    const template = sent.find(
      (message) => message.templateName === 'location_consent_request'
    );
    expect(template?.kind).toBe('template');
    expect(template?.messageParams?.buttonParams).toEqual({
      0: `${CONSENT_APPROVE_PREFIX}req-1`,
      1: `${CONSENT_DECLINE_PREFIX}req-1`,
    });
    expect(template?.messageParams?.body?.[2]).toContain('Ra••• Sh•••');
    expect(tables.property_location_requests[0]).toMatchObject({
      pending_consent_contact_id: C,
    });
    expect(
      tables.property_location_requests[0].consent_requested_at
    ).toBeTruthy();
  });

  it('does not mark a co-broker as awaiting when no approved template can deliver', async () => {
    const tables = freshTables();
    const admin = fakeAdmin(tables);
    const request = seedRequest(tables);

    expect(await requestConsentFromContact(admin, request, C)).toBe(false);
    expect(tables.property_location_requests[0]).toMatchObject({
      pending_consent_contact_id: null,
      consent_requested_at: null,
    });
  });

  it('uses the approved owner-decision template with request-scoped quick replies', async () => {
    const tables = freshTables();
    seedApprovalTemplates(tables);
    const admin = fakeAdmin(tables);
    const request = seedRequest(tables);

    await notifyOwnerQueue(admin, request);

    const template = sent.find(
      (message) => message.templateName === 'location_owner_decision'
    );
    expect(template?.kind).toBe('template');
    expect(template?.messageParams?.buttonParams).toEqual({
      0: `${OWNER_APPROVE_PREFIX}req-1`,
      1: `${OWNER_REJECT_PREFIX}req-1`,
    });
    expect(template?.messageParams?.body?.[2]).toContain('Ra••• Sh•••');
    expect(template?.messageParams?.body?.[2]).not.toContain('Rahul Sharma');
  });
});

describe('reveal delivery outside the 24-hour window', () => {
  // Seekers request from the public showcase, so their window is
  // usually closed: the dispatcher rejects free-form text to the
  // seeker's phone exactly like the real pre-flight guard.
  const windowClosedImpl = async (args: SentMessage) => {
    if (args.kind === 'text' && args.toPhone === '+919876543210') {
      sent.push(args);
      return { success: false, error: CUSTOMER_WINDOW_EXPIRED_MESSAGE };
    }
    return defaultDispatcherImpl(args);
  };

  beforeEach(() => {
    vi.mocked(sendWhatsAppMessageAndPersist).mockImplementation(
      windowClosedImpl as typeof sendWhatsAppMessageAndPersist
    );
  });
  afterEach(() => {
    vi.mocked(sendWhatsAppMessageAndPersist).mockImplementation(
      defaultDispatcherImpl as typeof sendWhatsAppMessageAndPersist
    );
  });

  function seedApprovedRevealTemplate(tables: Record<string, Row[]>) {
    tables.message_templates = [
      {
        id: 'tpl-reveal',
        account_id: ACCOUNT,
        name: 'location_reveal',
        status: 'APPROVED',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your request for the exact location of {{2}} has been approved by the listing team. Tap the button below to view the address, map pin and full photos. The link stays valid for 48 hours.',
        buttons: [
          {
            type: 'URL',
            text: 'View location',
            url: 'https://app.convoreal.com/reveal/{{1}}',
          },
        ],
        last_submitted_at: new Date().toISOString(),
      },
    ];
  }

  it('falls back to the approved location_reveal template with the token button', async () => {
    const tables = freshTables();
    seedApprovedRevealTemplate(tables);
    const admin = fakeAdmin(tables);
    const request = seedRequest(tables);

    const { shareLink, revealDelivered } = await approveRequestAndSendReveal(
      admin,
      request,
      OWNER_USER
    );

    expect(revealDelivered).toBe(true);
    const row = tables.property_location_requests[0];
    expect(row.status).toBe('approved');
    expect(row.share_sent_at).toBeTruthy();
    expect(shareLink).toContain(`/reveal/${row.share_token}`);

    const tpl = sent.find((m) => m.kind === 'template');
    expect(tpl?.templateName).toBe('location_reveal');
    expect(tpl?.toPhone).toBe('+919876543210');
    expect(tpl?.messageParams?.body?.[0]).toBe('Rahul');
    expect(tpl?.messageParams?.buttonParams?.[0]).toBe(row.share_token);
  });

  it('never claims the reveal was sent when no approved template exists', async () => {
    const tables = freshTables();
    const admin = fakeAdmin(tables);
    const request = seedRequest(tables);

    const { revealDelivered } = await approveRequestAndSendReveal(
      admin,
      request,
      OWNER_USER
    );

    expect(revealDelivered).toBe(false);
    const row = tables.property_location_requests[0];
    expect(row.status).toBe('approved');
    expect(row.share_sent_at).toBeUndefined();
    expect(sent.some((m) => m.kind === 'template')).toBe(false);
  });
});
