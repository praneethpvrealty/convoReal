import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let nextId = 0;

function parseOr(filter: string): Array<[string, string]> {
  return filter.split(',').map((part) => {
    const [column, , ...rest] = part.split('.');
    return [column, rest.join('.')];
  });
}

function makeAdmin() {
  return {
    from(table: string) {
      const tests: Array<(row: Row) => boolean> = [];
      let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let patch: Row = {};
      let inserted: Row[] = [];
      let limit = Infinity;
      let order: { column: string; ascending: boolean } | null = null;
      const rows = () => (tables[table] ||= []);
      const run = () => {
        if (mode === 'insert') return inserted;
        let matched = rows().filter((row) => tests.every((test) => test(row)));
        if (mode === 'update') {
          matched.forEach((row) => Object.assign(row, patch));
          return matched;
        }
        if (mode === 'delete') {
          tables[table] = rows().filter((row) => !matched.includes(row));
          return matched;
        }
        if (order) {
          const { column, ascending } = order;
          matched = [...matched].sort(
            (a, b) =>
              String(a[column]).localeCompare(String(b[column])) *
              (ascending ? 1 : -1)
          );
        }
        return matched.slice(0, limit);
      };
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (payload: Row | Row[]) => {
          mode = 'insert';
          inserted = (Array.isArray(payload) ? payload : [payload]).map(
            (row) => ({
              id: `${table}-${++nextId}`,
              created_at: new Date(Date.now() + nextId).toISOString(),
              ...row,
            })
          );
          rows().push(...inserted);
          return b;
        },
        upsert: (payload: Row) => (b.insert as (p: Row) => unknown)(payload),
        update: (values: Row) => {
          mode = 'update';
          patch = values;
          return b;
        },
        delete: () => {
          mode = 'delete';
          return b;
        },
        eq: (column: string, value: unknown) => {
          tests.push((row) => row[column] === value);
          return b;
        },
        is: (column: string, value: unknown) => {
          tests.push((row) => (row[column] ?? null) === value);
          return b;
        },
        not: (column: string) => {
          tests.push((row) => (row[column] ?? null) !== null);
          return b;
        },
        like: (column: string, pattern: string) => {
          tests.push((row) =>
            String(row[column]).startsWith(pattern.replace(/%$/, ''))
          );
          return b;
        },
        gte: (column: string, value: string) => {
          tests.push((row) => String(row[column]) >= value);
          return b;
        },
        lt: (column: string, value: string) => {
          tests.push((row) => String(row[column]) < value);
          return b;
        },
        or: (filter: string) => {
          const alternatives = parseOr(filter);
          tests.push((row) =>
            alternatives.some(([column, value]) => row[column] === value)
          );
          return b;
        },
        order: (column: string, options: { ascending: boolean }) => {
          order = { column, ascending: options.ascending };
          return b;
        },
        limit: (count: number) => {
          limit = count;
          return b;
        },
        maybeSingle: () =>
          Promise.resolve({ data: run()[0] ?? null, error: null }),
        single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: run(), error: null }).then(resolve),
      };
      return b;
    },
  };
}

const send = vi.fn();
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (args: unknown) => send(args),
}));
const notify = vi.fn<(input: Record<string, string>) => Promise<object>>(
  async () => ({})
);
vi.mock('@/lib/notifications/create', () => ({
  createNotification: (input: Record<string, string>) => notify(input),
}));
const fileInquiry = vi.fn<
  (admin: unknown, input: Row) => Promise<{ contactId: string }>
>(async () => ({ contactId: 'lead-1' }));
vi.mock('@/lib/showcase/file-inquiry', () => ({
  fileShowcaseInquiry: (admin: unknown, input: Row) =>
    fileInquiry(admin, input),
}));
const alertAgent = vi.fn<(args: Row) => Promise<void>>(async () => undefined);
vi.mock('@/lib/whatsapp/enquiry-alert', () => ({
  alertAgentOfPropertyEnquiry: (args: Row) => alertAgent(args),
}));
vi.mock('@/lib/inventory/location-requests', () => ({
  propertyTitle: async () => 'Commercial Building in Munnekolal',
  buildSeekerRedirectMessage: (title: string) => `speak to sharer: ${title}`,
}));
const loadTemplate = vi.fn();
vi.mock('@/lib/whatsapp/template-language', () => ({
  loadTemplateForContact: (...args: unknown[]) => loadTemplate(...args),
  warnLanguageFallback: () => undefined,
}));

const {
  REFERRED_APPROVE_PREFIX,
  REFERRED_DECLINE_PREFIX,
  REFERRAL_CONSENT_TIMEOUT_MS,
  buildReferrerAskMessage,
  handleReferredEnquiryReply,
  isExistingLead,
  lastGuestEnquiry,
  openReferredEnquiry,
  resolveSessionReferrer,
  resolveWhatsAppTapReferrer,
  sweepReferredEnquiryTimeouts,
} = await import('./referred-enquiries');

const ACCOUNT = 'acc-1';
const NIMMY = 'contact-nimmy';
const NIMMY_PHONE = '+918657601861';
const GUEST_PHONE = '+919845077813';
const SESSION = '9c7c5a9b-500d-4f42-9db5-846acfb385ec';
const OWNER_USER = 'user-owner';

const referrer = {
  contactId: NIMMY,
  name: 'Nimmy',
  phone: NIMMY_PHONE,
  isAgent: true,
};

const websitePayload = {
  accountId: ACCOUNT,
  phone: GUEST_PHONE,
  normalizedPhone: GUEST_PHONE,
  name: 'manju Poojappa',
  email: null,
  message: 'wants exact locations',
  isAiAgent: false,
  isShortlist: false,
  propertyId: 'prop-1',
  propertyTitle: 'Commercial Building in Munnekolal',
  propertyCode: 'PROP-2551',
  shortlistProperties: [],
  targetAgentUserId: OWNER_USER,
  referrerContactId: null,
  sessionKey: SESSION,
};

function openWebsite(overrides: Row = {}) {
  return openReferredEnquiry(makeAdmin() as never, {
    accountId: ACCOUNT,
    referrer,
    source: 'website',
    propertyId: 'prop-1',
    requesterName: 'manju Poojappa',
    requesterPhone: GUEST_PHONE,
    sessionKey: SESSION,
    payload: websitePayload,
    ...overrides,
  });
}

function askId(prefix: string): string {
  return `${prefix}${tables.referred_enquiries[0].id}`;
}

beforeEach(() => {
  nextId = 0;
  tables = {
    contacts: [
      {
        id: NIMMY,
        account_id: ACCOUNT,
        name: 'Nimmy',
        phone: NIMMY_PHONE,
        classification: 'Agent',
        is_merged: false,
        chain_only: false,
      },
    ],
    showcase_events: [],
    referred_enquiries: [],
    conversations: [{ id: 'conv-1', account_id: ACCOUNT, is_archived: true }],
    contact_property_inquiries: [],
  };
  send.mockReset();
  send.mockResolvedValue({ success: true });
  notify.mockClear();
  fileInquiry.mockClear();
  alertAgent.mockClear();
  loadTemplate.mockReset();
});

describe('[PLS-010] an agent’s guest is held until the agent approves', () => {
  it('reads the referrer from the session’s recorded events, never from the browser', async () => {
    tables.showcase_events.push({
      account_id: ACCOUNT,
      session_key: SESSION,
      contact_id: null,
      via_contact_id: NIMMY,
      created_at: '2026-11-17T00:38:00Z',
    });
    const found = await resolveSessionReferrer(makeAdmin() as never, {
      accountId: ACCOUNT,
      sessionKey: SESSION,
      requesterPhone: GUEST_PHONE,
    });
    expect(found).toMatchObject({ contactId: NIMMY, isAgent: true });
  });

  it('has no referrer for the link’s own recipient, an identified session, or another account', async () => {
    tables.showcase_events.push({
      account_id: ACCOUNT,
      session_key: SESSION,
      contact_id: null,
      via_contact_id: NIMMY,
      created_at: '2026-11-17T00:38:00Z',
    });
    const admin = makeAdmin() as never;
    expect(
      await resolveSessionReferrer(admin, {
        accountId: ACCOUNT,
        sessionKey: SESSION,
        requesterPhone: '8657601861',
      })
    ).toBeNull();
    expect(
      await resolveSessionReferrer(admin, {
        accountId: 'acc-other',
        sessionKey: SESSION,
        requesterPhone: GUEST_PHONE,
      })
    ).toBeNull();
    tables.showcase_events.push({
      account_id: ACCOUNT,
      session_key: SESSION,
      contact_id: 'contact-known',
      via_contact_id: null,
      created_at: '2026-11-17T00:39:00Z',
    });
    expect(
      await resolveSessionReferrer(admin, {
        accountId: ACCOUNT,
        sessionKey: SESSION,
        requesterPhone: GUEST_PHONE,
      })
    ).toBeNull();
    expect(
      await resolveSessionReferrer(admin, {
        accountId: ACCOUNT,
        sessionKey: 'a,b)or(1',
        requesterPhone: GUEST_PHONE,
      })
    ).toBeNull();
  });

  it('ties a WhatsApp enquiry to the session named in its reference, never to another visitor’s tap', async () => {
    tables.showcase_events.push({
      account_id: ACCOUNT,
      session_key: SESSION,
      property_id: 'prop-1',
      event_type: 'whatsapp_click',
      contact_id: null,
      via_contact_id: NIMMY,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const admin = makeAdmin() as never;
    const tap = {
      accountId: ACCOUNT,
      propertyId: 'prop-1',
      senderPhone: '919845959646',
    };
    expect(
      await resolveWhatsAppTapReferrer(admin, {
        ...tap,
        enquiryRef: '9c7c5a9b',
      })
    ).toMatchObject({ contactId: NIMMY, sessionKey: SESSION });
    expect(
      await resolveWhatsAppTapReferrer(admin, { ...tap, enquiryRef: null })
    ).toBeNull();
    expect(
      await resolveWhatsAppTapReferrer(admin, {
        ...tap,
        enquiryRef: 'deadbeef',
      })
    ).toBeNull();
    expect(
      await resolveWhatsAppTapReferrer(admin, { ...tap, enquiryRef: '%' })
    ).toBeNull();
    expect(
      await resolveWhatsAppTapReferrer(admin, {
        ...tap,
        propertyId: 'prop-other',
        enquiryRef: '9c7c5a9b',
      })
    ).toBeNull();
    expect(
      await resolveWhatsAppTapReferrer(admin, {
        ...tap,
        senderPhone: NIMMY_PHONE,
        enquiryRef: '9c7c5a9b',
      })
    ).toBeNull();
  });

  it('remembers whose guest a hidden WhatsApp contact is after the enquiry is decided', async () => {
    tables.referred_enquiries.push({
      id: 'r1',
      account_id: ACCOUNT,
      contact_id: 'guest-wa',
      via_contact_id: NIMMY,
      session_key: SESSION,
      status: 'rejected',
      created_at: '2026-11-17T00:40:00Z',
    });
    const admin = makeAdmin() as never;
    expect(
      await lastGuestEnquiry(admin, {
        accountId: ACCOUNT,
        contactId: 'guest-wa',
        senderPhone: '919845959646',
      })
    ).toMatchObject({
      status: 'rejected',
      sessionKey: SESSION,
      referrer: { contactId: NIMMY },
    });
    tables.referred_enquiries.push({
      id: 'r2',
      account_id: ACCOUNT,
      contact_id: null,
      requester_phone: '+919845077813',
      via_contact_id: NIMMY,
      session_key: SESSION,
      status: 'expired',
      created_at: '2026-11-17T00:41:00Z',
    });
    expect(
      await lastGuestEnquiry(admin, {
        accountId: ACCOUNT,
        contactId: 'hidden-after-decline',
        senderPhone: '919845077813',
      })
    ).toMatchObject({ status: 'expired', referrer: { contactId: NIMMY } });
    expect(
      await lastGuestEnquiry(admin, {
        accountId: 'acc-other',
        contactId: 'guest-wa',
        senderPhone: '919845959646',
      })
    ).toBeNull();
  });

  it('treats a number already in the contacts list as the account’s own lead', async () => {
    tables.contacts.push(
      {
        id: 'lead',
        account_id: ACCOUNT,
        phone: '919845077813',
        is_merged: false,
        chain_only: false,
      },
      {
        id: 'hidden',
        account_id: ACCOUNT,
        phone: '+919000000001',
        is_merged: false,
        chain_only: true,
      }
    );
    const admin = makeAdmin() as never;
    expect(await isExistingLead(admin, ACCOUNT, GUEST_PHONE)).toBe(true);
    expect(await isExistingLead(admin, ACCOUNT, '+919000000001')).toBe(false);
    expect(await isExistingLead(admin, 'acc-other', GUEST_PHONE)).toBe(false);
  });

  it('asks the agent with the guest masked and tells the listing side without the name or number', async () => {
    expect(await openWebsite()).toBe('pending');

    expect(tables.referred_enquiries).toHaveLength(1);
    expect(tables.referred_enquiries[0]).toMatchObject({
      status: 'pending',
      via_contact_id: NIMMY,
      requester_phone: GUEST_PHONE,
    });
    expect(fileInquiry).not.toHaveBeenCalled();

    const ask = send.mock.calls[0][0];
    expect(ask.contactId).toBe(NIMMY);
    expect(ask.interactiveButtons.map((b: { id: string }) => b.id)).toEqual([
      askId(REFERRED_APPROVE_PREFIX),
      askId(REFERRED_DECLINE_PREFIX),
    ]);
    expect(ask.interactiveBody).not.toContain('Poojappa');
    expect(ask.interactiveBody).not.toContain('9845077813');

    const alert = notify.mock.calls[0][0];
    expect(alert.userId).toBe(OWNER_USER);
    expect(alert.title).toBe("Nimmy's guest enquired");
    expect(alert.eventKey).toBe('referred_enquiry');
    expect(`${alert.title} ${alert.body}`).not.toContain('Poojappa');
    expect(`${alert.title} ${alert.body}`).not.toContain('9845077813');
    expect(alert.entityId).toBe(NIMMY);
  });

  it('says in the ask what each answer does and that silence declines', () => {
    const text = buildReferrerAskMessage({
      referrerName: 'Nimmy',
      subject: 'Villa',
      requesterName: 'manju Poojappa',
      requesterPhone: GUEST_PHONE,
    });
    expect(text).toContain('ma••• Po•••');
    expect(text).toContain('recorded as the referrer');
    expect(text).toContain('2 hours');
  });

  it('falls back to the approved consent template when the agent’s window is closed', async () => {
    send
      .mockResolvedValueOnce({ success: false, error: 'Re-engagement 131047' })
      .mockResolvedValueOnce({ success: true });
    loadTemplate.mockResolvedValue({
      template: {
        name: 'location_consent_request',
        status: 'APPROVED',
        language: 'en_US',
        body_text: 'Hi {{1}}, {{2}} — {{3}}',
      },
      language: 'en',
      fellBack: false,
    });
    expect(await openWebsite()).toBe('pending');
    const template = send.mock.calls[1][0];
    expect(template.kind).toBe('template');
    expect(template.messageParams.buttonParams).toEqual({
      0: askId(REFERRED_APPROVE_PREFIX),
      1: askId(REFERRED_DECLINE_PREFIX),
    });
    expect(template.text).not.toContain('Poojappa');
  });

  it('holds nothing when the agent cannot be asked, so the caller files the enquiry', async () => {
    send.mockResolvedValue({ success: false, error: 'invalid number' });
    expect(await openWebsite()).toBe('undeliverable');
    expect(tables.referred_enquiries[0].status).toBe('approved');
    expect(notify).not.toHaveBeenCalled();
  });

  it('asks once for one guest: a second enquiry or their WhatsApp from another number joins the wait', async () => {
    await openWebsite();
    expect(
      await openReferredEnquiry(makeAdmin() as never, {
        accountId: ACCOUNT,
        referrer,
        source: 'whatsapp',
        propertyId: 'prop-1',
        requesterName: 'Garments And Fitness Center',
        requesterPhone: '919845959646',
        sessionKey: SESSION,
        payload: {
          targetAgentUserId: OWNER_USER,
          propertyTitle: 'Commercial Building',
          enquiryText: 'Hi! I am interested',
        },
        contactId: 'guest-wa',
        conversationId: 'conv-1',
      })
    ).toBe('pending');
    expect(tables.referred_enquiries).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('files every waiting enquiry of the guest as a lead credited to the agent on Approve', async () => {
    tables.contacts.push({
      id: 'guest-wa',
      account_id: ACCOUNT,
      phone: '919845959646',
      chain_only: true,
    });
    await openWebsite();
    await openReferredEnquiry(makeAdmin() as never, {
      accountId: ACCOUNT,
      referrer,
      source: 'whatsapp',
      propertyId: 'prop-1',
      requesterName: 'Garments And Fitness Center',
      requesterPhone: '919845959646',
      sessionKey: SESSION,
      payload: {
        targetAgentUserId: OWNER_USER,
        propertyTitle: 'Commercial Building',
        enquiryText: 'Hi! I am interested',
      },
      contactId: 'guest-wa',
      conversationId: 'conv-1',
    });
    send.mockClear();
    notify.mockClear();

    const handled = await handleReferredEnquiryReply({
      admin: makeAdmin() as never,
      accountId: ACCOUNT,
      replyId: askId(REFERRED_APPROVE_PREFIX),
      senderPhone: '918657601861',
    });

    expect(handled).toBe(true);
    expect(tables.referred_enquiries.map((row) => row.status)).toEqual([
      'approved',
      'approved',
    ]);
    expect(fileInquiry.mock.calls[0][1]).toMatchObject({
      normalizedPhone: GUEST_PHONE,
      referrerContactId: NIMMY,
    });
    expect(notify.mock.calls[0][0].title).toBe(
      'Nimmy approved: manju Poojappa is your lead'
    );
    expect(notify.mock.calls[0][0].entityId).toBe('lead-1');

    const guest = tables.contacts.find((row) => row.id === 'guest-wa')!;
    expect(guest).toMatchObject({
      chain_only: false,
      referrer_contact_id: NIMMY,
    });
    expect(tables.conversations[0]).toMatchObject({
      is_archived: false,
      unread_count: 1,
    });
    expect(alertAgent.mock.calls[0][0]).toMatchObject({
      contactId: 'guest-wa',
      referredByName: 'Nimmy',
    });
    expect(send.mock.calls.at(-1)![0].contactId).toBe(NIMMY);
  });

  it('never files the guest on Decline: they are pointed back to the agent', async () => {
    await openWebsite();
    send.mockClear();
    notify.mockClear();

    await handleReferredEnquiryReply({
      admin: makeAdmin() as never,
      accountId: ACCOUNT,
      replyId: askId(REFERRED_DECLINE_PREFIX),
      senderPhone: NIMMY_PHONE,
    });

    expect(tables.referred_enquiries[0].status).toBe('rejected');
    expect(fileInquiry).not.toHaveBeenCalled();
    const redirect = send.mock.calls[0][0];
    expect(redirect.toPhone).toContain('9845077813');
    expect(redirect.createAsChainOnly).toBe(true);
    expect(notify.mock.calls[0][0].title).toBe(
      'Nimmy declined a guest enquiry'
    );
    expect(notify.mock.calls[0][0].body).not.toContain('Poojappa');
  });

  it('tells the listing side and the agent when the declined guest could not be messaged', async () => {
    await openWebsite();
    send.mockReset();
    send
      .mockResolvedValueOnce({ success: false, error: 'Re-engagement 131047' })
      .mockResolvedValue({ success: true });
    notify.mockClear();

    await handleReferredEnquiryReply({
      admin: makeAdmin() as never,
      accountId: ACCOUNT,
      replyId: askId(REFERRED_DECLINE_PREFIX),
      senderPhone: NIMMY_PHONE,
    });

    expect(notify.mock.calls[0][0].body).toContain(
      'could not be messaged on WhatsApp'
    );
    expect(notify.mock.calls[0][0].body).not.toContain('Poojappa');
    expect(send.mock.calls.at(-1)![0]).toMatchObject({ contactId: NIMMY });
    expect(send.mock.calls.at(-1)![0].text).toContain('follow up with them');
  });

  it('puts an approved enquiry that could not be filed back to waiting and does not confirm it', async () => {
    await openWebsite();
    send.mockClear();
    notify.mockClear();
    fileInquiry.mockRejectedValueOnce(new Error('contact insert failed'));

    await handleReferredEnquiryReply({
      admin: makeAdmin() as never,
      accountId: ACCOUNT,
      replyId: askId(REFERRED_APPROVE_PREFIX),
      senderPhone: NIMMY_PHONE,
    });
    expect(tables.referred_enquiries[0]).toMatchObject({
      status: 'pending',
      decided_at: null,
    });
    expect(notify).not.toHaveBeenCalled();
    expect(send.mock.calls.at(-1)![0].text).toContain('tap Approve again');

    await handleReferredEnquiryReply({
      admin: makeAdmin() as never,
      accountId: ACCOUNT,
      replyId: askId(REFERRED_APPROVE_PREFIX),
      senderPhone: NIMMY_PHONE,
    });
    expect(tables.referred_enquiries[0].status).toBe('approved');
    expect(send.mock.calls.at(-1)![0].text).toContain(
      'recorded as the referrer'
    );
  });

  it('confirms an approval only when every enquiry was filed, and a second Approve files the rest', async () => {
    await openWebsite();
    await openWebsite({
      propertyId: 'prop-2',
      payload: { ...websitePayload, propertyId: 'prop-2' },
    });
    send.mockClear();
    fileInquiry
      .mockResolvedValueOnce({ contactId: 'lead-1' })
      .mockRejectedValueOnce(new Error('transient'));
    const approve = () =>
      handleReferredEnquiryReply({
        admin: makeAdmin() as never,
        accountId: ACCOUNT,
        replyId: askId(REFERRED_APPROVE_PREFIX),
        senderPhone: NIMMY_PHONE,
      });

    await approve();
    expect(tables.referred_enquiries.map((row) => row.status)).toEqual([
      'approved',
      'pending',
    ]);
    expect(send.mock.calls.at(-1)![0].text).toContain('tap Approve again');

    await approve();
    expect(tables.referred_enquiries.map((row) => row.status)).toEqual([
      'approved',
      'approved',
    ]);
    expect(send.mock.calls.at(-1)![0].text).toContain(
      'recorded as the referrer'
    );
    expect(fileInquiry).toHaveBeenCalledTimes(3);
  });

  it('makes a lead visible when the approved number belonged to a hidden contact', async () => {
    tables.contacts.push({
      id: 'lead-1',
      account_id: ACCOUNT,
      phone: GUEST_PHONE,
      chain_only: true,
    });
    await openWebsite();
    await handleReferredEnquiryReply({
      admin: makeAdmin() as never,
      accountId: ACCOUNT,
      replyId: askId(REFERRED_APPROVE_PREFIX),
      senderPhone: NIMMY_PHONE,
    });
    expect(tables.contacts.find((row) => row.id === 'lead-1')!.chain_only).toBe(
      false
    );
  });

  it('ignores a tap from anyone but the agent, from another account, or on a decided enquiry', async () => {
    await openWebsite();
    const admin = makeAdmin() as never;
    await handleReferredEnquiryReply({
      admin,
      accountId: ACCOUNT,
      replyId: askId(REFERRED_APPROVE_PREFIX),
      senderPhone: '+919999999999',
    });
    await handleReferredEnquiryReply({
      admin,
      accountId: 'acc-other',
      replyId: askId(REFERRED_APPROVE_PREFIX),
      senderPhone: NIMMY_PHONE,
    });
    expect(tables.referred_enquiries[0].status).toBe('pending');

    await handleReferredEnquiryReply({
      admin,
      accountId: ACCOUNT,
      replyId: askId(REFERRED_DECLINE_PREFIX),
      senderPhone: NIMMY_PHONE,
    });
    await handleReferredEnquiryReply({
      admin,
      accountId: ACCOUNT,
      replyId: askId(REFERRED_APPROVE_PREFIX),
      senderPhone: NIMMY_PHONE,
    });
    expect(tables.referred_enquiries[0].status).toBe('rejected');
    expect(fileInquiry).not.toHaveBeenCalled();
  });

  it('closes an enquiry the agent left unanswered for two hours, exactly like a decline', async () => {
    await openWebsite();
    send.mockClear();
    notify.mockClear();
    expect(await sweepReferredEnquiryTimeouts(makeAdmin() as never)).toBe(0);

    tables.referred_enquiries[0].consent_requested_at = new Date(
      Date.now() - REFERRAL_CONSENT_TIMEOUT_MS - 60_000
    ).toISOString();
    expect(await sweepReferredEnquiryTimeouts(makeAdmin() as never)).toBe(1);
    expect(tables.referred_enquiries[0].status).toBe('expired');
    expect(fileInquiry).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0].toPhone).toContain('9845077813');
    expect(notify.mock.calls[0][0].title).toBe(
      'No answer from Nimmy on a guest enquiry'
    );
    expect(await sweepReferredEnquiryTimeouts(makeAdmin() as never)).toBe(0);
  });

  it('does not ask the agent again within a day of their decline', async () => {
    await openWebsite();
    await handleReferredEnquiryReply({
      admin: makeAdmin() as never,
      accountId: ACCOUNT,
      replyId: askId(REFERRED_DECLINE_PREFIX),
      senderPhone: NIMMY_PHONE,
    });
    send.mockClear();
    notify.mockClear();

    expect(await openWebsite()).toBe('closed');
    expect(send).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(tables.referred_enquiries[1].status).toBe('rejected');
  });
});
