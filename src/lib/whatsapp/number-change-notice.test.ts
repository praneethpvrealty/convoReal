import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clampRecentDays,
  maybeSendNumberChangePrecursor,
  notifyRecentContacts,
  numberChangeWindow,
  sendNumberChangeNotice,
  type NoticeSender,
} from './number-change-notice';

interface Call {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
}

let queues: Record<
  string,
  Array<{ data?: unknown; error?: unknown; count?: number }>
>;
let calls: Call[];
let rpcCalls: Array<{ fn: string; params: unknown }>;
let rpcResult: { data?: unknown; error?: unknown };

function makeDb(): SupabaseClient {
  return {
    rpc(fn: string, params: unknown) {
      rpcCalls.push({ fn, params });
      return Promise.resolve(rpcResult);
    },
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const resolve = () => {
        const next = (queues[table] ?? []).shift() ?? {
          data: null,
          error: null,
        };
        return Promise.resolve(next);
      };
      const builder: Record<string, (...args: unknown[]) => unknown> = {
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        in: () => builder,
        not: () => builder,
        eq: (col: unknown, val: unknown) => {
          call.filters.push([col as string, 'eq', val]);
          return builder;
        },
        insert: (payload: unknown) => {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        update: (payload: unknown) => {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        delete: () => {
          call.op = 'delete';
          return builder;
        },
        maybeSingle: () => resolve(),
        single: () => resolve(),
        then: (onFulfilled: unknown, onRejected: unknown) =>
          resolve().then(
            onFulfilled as (v: unknown) => unknown,
            onRejected as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const liveConfig = {
  phone_number_id: 'pn-new',
  integration_type: 'official_api',
  previous_display_phone_number: '+91 88677 09556',
  number_changed_at: new Date(NOW - 2 * DAY).toISOString(),
};

const approvedTemplate = {
  name: 'contact_number_update',
  language: 'en_US',
  status: 'APPROVED',
  body_text:
    'Hi {{1}}, this is an account notice from {{2}}. Previous number {{3}} is closed.',
};

function sender(result = { success: true, messageId: 'msg-1' }) {
  const sent: Parameters<NoticeSender>[0][] = [];
  const send: NoticeSender = async (args) => {
    sent.push(args);
    return result;
  };
  return { send, sent };
}

beforeEach(() => {
  queues = {};
  calls = [];
  rpcCalls = [];
  rpcResult = { data: [] };
});

describe('[WAN-004] the notice window follows the recorded switch', () => {
  it('is active for seven days after a switch on an Official API number', () => {
    const window = numberChangeWindow(liveConfig, NOW);
    expect(window.active).toBe(true);
    expect(window.previousNumber).toBe('+91 88677 09556');
    expect(window.expiresAt).toBe(new Date(NOW + 5 * DAY).toISOString());
  });

  it('is inactive once seven days have passed, without a previous number, or on sandbox', () => {
    expect(
      numberChangeWindow(
        {
          ...liveConfig,
          number_changed_at: new Date(NOW - 8 * DAY).toISOString(),
        },
        NOW
      ).active
    ).toBe(false);
    expect(
      numberChangeWindow(
        { ...liveConfig, previous_display_phone_number: null },
        NOW
      ).active
    ).toBe(false);
    expect(
      numberChangeWindow({ ...liveConfig, integration_type: 'sandbox' }, NOW)
        .active
    ).toBe(false);
    expect(numberChangeWindow(null, NOW).active).toBe(false);
  });

  it('clamps the recent-contact lookback to 1–30 days, defaulting to 7', () => {
    expect(clampRecentDays(undefined)).toBe(7);
    expect(clampRecentDays('abc')).toBe(7);
    expect(clampRecentDays(0)).toBe(1);
    expect(clampRecentDays(90)).toBe(30);
    expect(clampRecentDays('14')).toBe(14);
  });
});

describe('[WAN-005] each contact is told once, by the channel their window allows', () => {
  const base = {
    accountId: 'acc-1',
    contactId: 'c-1',
    phoneNumberId: 'pn-new',
    previousNumber: '+91 88677 09556',
    businessName: 'Aryavarta Realty',
    contactName: 'Gopi Krishna',
    contactLanguage: 'en',
  } as const;

  it('does not send again when the ledger already holds the contact', async () => {
    queues.whatsapp_number_change_notices = [
      { data: null, error: { code: '23505', message: 'dup' } },
    ];
    const { send, sent } = sender();
    const outcome = await sendNumberChangeNotice(makeDb(), {
      ...base,
      trigger: 'precursor',
      send,
    });
    expect(outcome).toEqual({ status: 'already' });
    expect(sent).toHaveLength(0);
  });

  it('sends the notice free-form inside an open 24-hour window', async () => {
    queues.whatsapp_number_change_notices = [
      { data: { id: 'claim-1' } },
      { data: [{ id: 'claim-1' }] },
    ];
    queues.conversations = [{ data: { id: 'conv-1' } }];
    queues.messages = [
      { data: { created_at: new Date(Date.now() - HOUR).toISOString() } },
    ];
    const { send, sent } = sender();

    const outcome = await sendNumberChangeNotice(makeDb(), {
      ...base,
      trigger: 'manual',
      send,
    });

    expect(outcome).toEqual({
      status: 'sent',
      channel: 'freeform',
      messageId: 'msg-1',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('text');
    expect(sent[0].numberChangeNotice).toBe(true);
    expect(sent[0].text).toContain(
      'Hi Gopi, this is an account notice from Aryavarta Realty.'
    );
    expect(sent[0].text).toContain('+91 88677 09556');
    const claim = calls.find(
      (c) => c.table === 'whatsapp_number_change_notices' && c.op === 'insert'
    );
    expect(claim?.payload).toMatchObject({
      account_id: 'acc-1',
      contact_id: 'c-1',
      phone_number_id: 'pn-new',
      trigger: 'manual',
      channel: 'pending',
    });
    const stamp = calls.find(
      (c) => c.table === 'whatsapp_number_change_notices' && c.op === 'update'
    );
    expect(stamp?.payload).toMatchObject({
      channel: 'freeform',
      message_id: 'msg-1',
    });
  });

  it('uses the approved template outside the window, with name, business and old number', async () => {
    queues.whatsapp_number_change_notices = [
      { data: { id: 'claim-1' } },
      { data: [{ id: 'claim-1' }] },
    ];
    queues.conversations = [{ data: { id: 'conv-1' } }];
    queues.messages = [
      { data: { created_at: new Date(Date.now() - 3 * DAY).toISOString() } },
    ];
    queues.message_templates = [{ data: [approvedTemplate] }];
    const { send, sent } = sender();

    const outcome = await sendNumberChangeNotice(makeDb(), {
      ...base,
      trigger: 'precursor',
      send,
    });

    expect(outcome).toEqual({
      status: 'sent',
      channel: 'template',
      messageId: 'msg-1',
    });
    expect(sent[0].kind).toBe('template');
    expect(sent[0].templateName).toBe('contact_number_update');
    expect(sent[0].templateParams).toEqual([
      'Gopi',
      'Aryavarta Realty',
      '+91 88677 09556',
    ]);
    expect(sent[0].senderType).toBe('bot');
    const stamp = calls.find(
      (c) => c.table === 'whatsapp_number_change_notices' && c.op === 'update'
    );
    expect(stamp?.payload).toMatchObject({ channel: 'template' });
  });

  it('releases the claim and sends nothing when no approved template exists outside the window', async () => {
    queues.whatsapp_number_change_notices = [{ data: { id: 'claim-1' } }];
    queues.conversations = [{ data: null }];
    queues.message_templates = [
      { data: [{ ...approvedTemplate, status: 'PENDING' }] },
    ];
    const { send, sent } = sender();

    const outcome = await sendNumberChangeNotice(makeDb(), {
      ...base,
      trigger: 'manual',
      send,
    });

    expect(outcome).toEqual({
      status: 'skipped',
      reason: 'template_not_approved',
    });
    expect(sent).toHaveLength(0);
    const release = calls.find(
      (c) => c.table === 'whatsapp_number_change_notices' && c.op === 'delete'
    );
    expect(release?.filters).toContainEqual(['id', 'eq', 'claim-1']);
  });

  it('releases the claim when the send fails, so a later attempt can retry', async () => {
    queues.whatsapp_number_change_notices = [{ data: { id: 'claim-1' } }];
    queues.conversations = [{ data: { id: 'conv-1' } }];
    queues.messages = [{ data: { created_at: new Date().toISOString() } }];
    const { send } = sender({ success: false, error: 'Meta down' } as never);

    const outcome = await sendNumberChangeNotice(makeDb(), {
      ...base,
      trigger: 'manual',
      send,
    });

    expect(outcome).toEqual({ status: 'failed', reason: 'Meta down' });
    expect(
      calls.some(
        (c) => c.table === 'whatsapp_number_change_notices' && c.op === 'delete'
      )
    ).toBe(true);
  });

  it('runs the precursor only inside the window and never for the notice itself', async () => {
    const { send, sent } = sender();
    await maybeSendNumberChangePrecursor(makeDb(), {
      accountId: 'acc-1',
      contactId: 'c-1',
      config: {
        ...liveConfig,
        number_changed_at: new Date(Date.now() - 9 * DAY).toISOString(),
      },
      send,
    });
    expect(calls).toHaveLength(0);
    expect(sent).toHaveLength(0);

    queues.whatsapp_number_change_notices = [
      { data: { id: 'claim-1' } },
      { data: [{ id: 'claim-1' }] },
    ];
    queues.accounts = [{ data: { name: 'Aryavarta Realty' } }];
    queues.contacts = [{ data: { name: 'Gopi', preferred_language: null } }];
    queues.conversations = [{ data: { id: 'conv-1' } }];
    queues.messages = [{ data: { created_at: new Date().toISOString() } }];
    await maybeSendNumberChangePrecursor(makeDb(), {
      accountId: 'acc-1',
      contactId: 'c-1',
      config: {
        ...liveConfig,
        number_changed_at: new Date(Date.now() - DAY).toISOString(),
      },
      send,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].numberChangeNotice).toBe(true);
    const claim = calls.find((c) => c.op === 'insert');
    expect(claim?.payload).toMatchObject({ trigger: 'precursor' });
  });

  it('notifies the recent audience from the SQL function and stops at the first missing template', async () => {
    rpcResult = {
      data: [
        {
          contact_id: 'c-1',
          name: 'Gopi',
          preferred_language: null,
          last_message_at: null,
        },
        {
          contact_id: 'c-2',
          name: 'Asha',
          preferred_language: 'hi',
          last_message_at: null,
        },
      ],
    };
    queues.whatsapp_number_change_notices = [
      { data: { id: 'claim-1' } },
      { data: [{ id: 'claim-1' }] },
      { data: { id: 'claim-2' } },
    ];
    queues.conversations = [{ data: { id: 'conv-1' } }, { data: null }];
    queues.messages = [{ data: { created_at: new Date().toISOString() } }];
    queues.message_templates = [{ data: [] }];
    const { send, sent } = sender();

    const result = await notifyRecentContacts({
      userDb: makeDb(),
      adminDb: makeDb(),
      accountId: 'acc-1',
      window: numberChangeWindow(liveConfig, Date.now()),
      days: 7,
      businessName: 'Aryavarta Realty',
      accountLanguage: 'en',
      send,
    });

    expect(rpcCalls[0]).toMatchObject({
      fn: 'whatsapp_number_change_audience',
      params: expect.objectContaining({
        p_account_id: 'acc-1',
        p_phone_number_id: 'pn-new',
      }),
    });
    expect(result).toEqual({
      audience: 2,
      sent: 1,
      viaTemplate: 0,
      viaFreeform: 1,
      skippedNoTemplate: 1,
      failed: 0,
    });
    expect(sent).toHaveLength(1);
  });
});
