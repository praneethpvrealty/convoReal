import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NumberProfileRow } from './number-profiles';
import {
  defaultRetiredNumberReply,
  loadRetiredNumberProfile,
  renderRetiredNumberReply,
  replyFromRetiredNumber,
  waMeLink,
} from './retired-number-reply';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => value.replace(/^enc:/, ''),
  encrypt: (value: string) => `enc:${value}`,
}));

vi.mock('@/lib/notifications/create', () => ({
  createNotification: vi.fn(async () => ({
    inAppId: 'n-1',
    whatsapp: null,
    pushCount: 0,
  })),
}));

interface Call {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
}

let queues: Record<string, Array<{ data?: unknown; error?: unknown }>>;
let calls: Call[];

function makeDb(): SupabaseClient {
  return {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const resolve = () =>
        Promise.resolve(
          (queues[table] ?? []).shift() ?? { data: null, error: null }
        );
      const builder: Record<string, (...args: unknown[]) => unknown> = {
        select: () => builder,
        limit: () => builder,
        eq: (col: unknown, val: unknown) => {
          call.filters.push([col as string, 'eq', val]);
          return builder;
        },
        lt: (col: unknown, val: unknown) => {
          call.filters.push([col as string, 'lt', val]);
          return builder;
        },
        like: (col: unknown, val: unknown) => {
          call.filters.push([col as string, 'like', val]);
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

const NOW = new Date('2026-09-19T06:00:00.000Z');

type Deps = NonNullable<Parameters<typeof replyFromRetiredNumber>[3]>;
type Send = NonNullable<Deps['send']>;
type Notify = NonNullable<Deps['notify']>;

const retired: NumberProfileRow = {
  id: 'prof-old',
  account_id: 'acc-1',
  label: '',
  phone_number_id: 'pn-old',
  display_phone_number: '+91 88677 09556',
  verified_name: 'Price Value Consulting',
  waba_id: 'waba-1',
  access_token: 'enc:old-token',
  verify_token: null,
  catalog_id: null,
  auto_sync_catalog: false,
  registered_at: '2026-06-08T05:45:32.000Z',
  subscribed_apps_at: null,
  last_registration_error: null,
  last_activated_at: '2026-09-18T15:28:53.000Z',
  auto_reply_enabled: true,
  auto_reply_message: null,
  created_at: '2026-09-18T15:28:53.000Z',
  updated_at: '2026-09-18T15:28:53.000Z',
};

const liveNew = {
  phone_number_id: 'pn-new',
  integration_type: 'official_api',
  display_phone_number: '+91 83173 02613',
  user_id: 'admin-1',
};

const inbound = {
  senderPhone: '919876543210',
  senderName: 'Rohit',
  messageId: 'wamid.in-1',
  preview: 'Is the villa still available?',
};

function arrange(overrides: Partial<typeof queues> = {}) {
  queues = {
    whatsapp_config: [{ data: liveNew }],
    accounts: [{ data: { name: 'Aryavarta Ventures' } }],
    profiles: [{ data: { user_id: 'owner-1' } }],
    contacts: [
      { data: [{ id: 'c-1', name: 'Rohit Sharma', phone: '+919876543210' }] },
    ],
    whatsapp_retired_number_replies: [{ data: { id: 'r-1' }, error: null }],
    ...overrides,
  };
}

beforeEach(() => {
  queues = {};
  calls = [];
  vi.clearAllMocks();
});

describe('[WAN-006] reply copy', () => {
  it('defaults to the business name, the live number and a tap-to-chat link', () => {
    const text = defaultRetiredNumberReply({
      businessName: 'Aryavarta Ventures',
      newNumber: '+91 83173 02613',
    });
    expect(text).toContain('Aryavarta Ventures has moved');
    expect(text).toContain('+91 83173 02613');
    expect(text).toContain('https://wa.me/918317302613');
    expect(waMeLink(null)).toBeNull();
  });

  it('still reads sensibly without a business name or a live number', () => {
    const text = defaultRetiredNumberReply({
      businessName: null,
      newNumber: null,
    });
    expect(text.startsWith('We have moved')).toBe(true);
    expect(text).not.toContain('wa.me');
  });

  it('fills the placeholders in a custom message and falls back when it renders empty', () => {
    const ctx = { businessName: 'Aryavarta', newNumber: '+91 83173 02613' };
    expect(
      renderRetiredNumberReply(
        '{{business_name}} moved to {{new_number}} — {{link}}',
        ctx
      )
    ).toBe('Aryavarta moved to +91 83173 02613 — https://wa.me/918317302613');
    expect(
      renderRetiredNumberReply('{{link}}', { ...ctx, newNumber: null })
    ).toBe(defaultRetiredNumberReply({ ...ctx, newNumber: null }));
  });
});

describe('[WAN-006] replying from a retired number', () => {
  it('only loads a profile that has the auto-reply switched on', async () => {
    queues.whatsapp_number_profiles = [{ data: retired }];
    const profile = await loadRetiredNumberProfile(makeDb(), 'pn-old');
    expect(profile?.id).toBe('prof-old');
    const lookup = calls[0];
    expect(lookup.filters).toContainEqual(['phone_number_id', 'eq', 'pn-old']);
    expect(lookup.filters).toContainEqual(['auto_reply_enabled', 'eq', true]);
  });

  it('replies from the retired number with the default message, quoting the inbound, and mirrors it to the account owner rather than whoever saved the config', async () => {
    arrange();
    const send = vi.fn<Send>(async () => ({ messageId: 'wamid.out-1' }));
    const notify = vi.fn<Notify>(async () => ({
      inAppId: 'n-1',
      whatsapp: null,
      pushCount: 1,
    }));

    const outcome = await replyFromRetiredNumber(makeDb(), retired, inbound, {
      send,
      notify,
      now: () => NOW,
    });

    expect(outcome).toBe('replied');
    expect(send).toHaveBeenCalledTimes(1);
    const args = send.mock.calls[0][0];
    expect(args.phoneNumberId).toBe('pn-old');
    expect(args.accessToken).toBe('old-token');
    expect(args.to).toBe('919876543210');
    expect(args.contextMessageId).toBe('wamid.in-1');
    expect(args.text).toContain('+91 83173 02613');
    expect(args.text).toContain('https://wa.me/918317302613');

    const claim = calls.find(
      (c) => c.table === 'whatsapp_retired_number_replies' && c.op === 'insert'
    );
    expect(claim?.payload).toMatchObject({
      account_id: 'acc-1',
      phone_number_id: 'pn-old',
      sender_phone: '919876543210',
      reply_count: 1,
    });

    const ownerLookup = calls.find((c) => c.table === 'profiles');
    expect(ownerLookup?.filters).toContainEqual(['account_id', 'eq', 'acc-1']);
    expect(ownerLookup?.filters).toContainEqual([
      'account_role',
      'eq',
      'owner',
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      accountId: 'acc-1',
      userId: 'owner-1',
      type: 'new_message',
      entityType: 'contact',
      entityId: 'c-1',
      link: '/contacts/c-1',
      body: 'Rohit Sharma: Is the villa still available?',
      channels: { inApp: true, whatsapp: false, push: true },
    });
  });

  it('uses the custom message when one is saved', async () => {
    arrange();
    const send = vi.fn<Send>(async () => ({ messageId: 'wamid.out-1' }));
    await replyFromRetiredNumber(
      makeDb(),
      { ...retired, auto_reply_message: 'New number: {{new_number}}' },
      inbound,
      { send, now: () => NOW }
    );
    expect(send.mock.calls[0][0].text).toBe('New number: +91 83173 02613');
  });

  it('replies at most once per sender per day, but still surfaces the message', async () => {
    arrange({
      whatsapp_retired_number_replies: [
        { data: null, error: { code: '23505' } },
        {
          data: {
            id: 'r-1',
            reply_count: 1,
            last_replied_at: '2026-09-19T01:00:00.000Z',
          },
        },
      ],
    });
    const send = vi.fn<Send>(async () => ({ messageId: 'x' }));
    const notify = vi.fn<Notify>(async () => ({
      inAppId: null,
      whatsapp: null,
      pushCount: 0,
    }));
    const outcome = await replyFromRetiredNumber(makeDb(), retired, inbound, {
      send,
      notify,
      now: () => NOW,
    });
    expect(outcome).toBe('cooldown');
    expect(send).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('replies again once the day has passed, taking the row only if nobody else did', async () => {
    arrange({
      whatsapp_retired_number_replies: [
        { data: null, error: { code: '23505' } },
        {
          data: {
            id: 'r-1',
            reply_count: 1,
            last_replied_at: '2026-09-17T01:00:00.000Z',
          },
        },
        { data: [{ id: 'r-1' }] },
      ],
    });
    const send = vi.fn<Send>(async () => ({ messageId: 'x' }));
    const outcome = await replyFromRetiredNumber(makeDb(), retired, inbound, {
      send,
      now: () => NOW,
    });
    expect(outcome).toBe('replied');
    const bump = calls.find(
      (c) => c.table === 'whatsapp_retired_number_replies' && c.op === 'update'
    );
    expect(bump?.payload).toMatchObject({
      reply_count: 2,
      last_replied_at: NOW.toISOString(),
    });
    expect(bump?.filters).toContainEqual(['account_id', 'eq', 'acc-1']);
    expect(bump?.filters).toContainEqual([
      'last_replied_at',
      'lt',
      new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    ]);
  });

  it('releases the claim when Meta rejects the reply so the next message retries', async () => {
    arrange();
    const send = vi.fn<Send>(async () => {
      throw new Error('Meta API error: 401');
    });
    const outcome = await replyFromRetiredNumber(makeDb(), retired, inbound, {
      send,
      now: () => NOW,
    });
    expect(outcome).toBe('failed');
    const release = calls.find(
      (c) => c.table === 'whatsapp_retired_number_replies' && c.op === 'delete'
    );
    expect(release?.filters).toContainEqual(['id', 'eq', 'r-1']);
    expect(release?.filters).toContainEqual(['account_id', 'eq', 'acc-1']);
  });

  it('falls back to whoever saved the config when the account has no owner profile', async () => {
    arrange({ profiles: [{ data: null }] });
    const notify = vi.fn<Notify>(async () => ({
      inAppId: null,
      whatsapp: null,
      pushCount: 0,
    }));
    await replyFromRetiredNumber(makeDb(), retired, inbound, {
      send: vi.fn<Send>(async () => ({ messageId: 'x' })),
      notify,
      now: () => NOW,
    });
    expect(notify.mock.calls[0][0]).toMatchObject({ userId: 'admin-1' });
  });

  it('never replies from the number that is currently live', async () => {
    arrange({
      whatsapp_config: [{ data: { ...liveNew, phone_number_id: 'pn-old' } }],
    });
    const send = vi.fn<Send>(async () => ({ messageId: 'x' }));
    const notify = vi.fn<Notify>(async () => ({
      inAppId: null,
      whatsapp: null,
      pushCount: 0,
    }));
    const outcome = await replyFromRetiredNumber(makeDb(), retired, inbound, {
      send,
      notify,
      now: () => NOW,
    });
    expect(outcome).toBe('live');
    expect(send).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
