import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { UserFacingError } from '@/lib/auth/account';
import {
  activateNumberProfile,
  deleteNumberProfile,
  isPhoneNumberClaimedElsewhere,
  isProfileActive,
  liveConfigFromProfile,
  normalizeProfileLabel,
  snapshotFromLiveConfig,
  summarizeProfile,
  upsertNumberProfile,
  type NumberProfileRow,
} from './number-profiles';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => {
    if (value === 'enc:broken') throw new Error('bad key');
    return value.replace(/^enc:/, '');
  },
  encrypt: (value: string) => `enc:${value}`,
}));

interface Call {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
  options?: unknown;
}

let queues: Record<string, Array<{ data?: unknown; error?: unknown }>>;
let calls: Call[];

function makeDb(): SupabaseClient {
  return {
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
        eq: (col: unknown, val: unknown) => {
          call.filters.push([col as string, 'eq', val]);
          return builder;
        },
        neq: (col: unknown, val: unknown) => {
          call.filters.push([col as string, 'neq', val]);
          return builder;
        },
        update: (payload: unknown) => {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        insert: (payload: unknown) => {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        upsert: (payload: unknown, options: unknown) => {
          call.op = 'upsert';
          call.payload = payload;
          call.options = options;
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

const NOW = '2026-09-18T10:00:00.000Z';

const salesProfile: NumberProfileRow = {
  id: 'prof-sales',
  account_id: 'acc-1',
  label: 'Sales desk',
  phone_number_id: 'pn-sales',
  display_phone_number: '+91 88000 00001',
  verified_name: 'PV Realty Sales',
  waba_id: 'waba-1',
  access_token: 'enc:sales-token',
  verify_token: 'enc:verify',
  catalog_id: 'cat-1',
  auto_sync_catalog: true,
  registered_at: '2026-08-06T05:45:32.000Z',
  subscribed_apps_at: '2026-08-06T05:45:33.000Z',
  last_registration_error: null,
  last_activated_at: '2026-08-06T05:45:32.000Z',
  created_at: '2026-08-06T05:45:32.000Z',
  updated_at: '2026-08-06T05:45:32.000Z',
};

const liveRentals = {
  id: 'cfg-1',
  account_id: 'acc-1',
  integration_type: 'official_api',
  phone_number_id: 'pn-rentals',
  display_phone_number: '+91 88000 00002',
  waba_id: 'waba-2',
  access_token: 'enc:rentals-token',
  verify_token: null,
  catalog_id: null,
  auto_sync_catalog: false,
  registered_at: '2026-09-01T00:00:00.000Z',
  subscribed_apps_at: '2026-09-01T00:00:01.000Z',
  last_registration_error: null,
};

const cloudApiState = async () => ({
  status: 'CONNECTED',
  platformType: 'CLOUD_API',
  nameStatus: 'APPROVED',
  verifiedName: 'PV Realty Sales',
  pinEnabled: true,
});

beforeEach(() => {
  queues = {};
  calls = [];
});

describe('[WAN-001] every saved Official API number becomes a profile', () => {
  it('snapshots only an Official API config that carries credentials', () => {
    expect(snapshotFromLiveConfig(liveRentals)).toMatchObject({
      phone_number_id: 'pn-rentals',
      access_token: 'enc:rentals-token',
      waba_id: 'waba-2',
      registered_at: '2026-09-01T00:00:00.000Z',
    });
    expect(
      snapshotFromLiveConfig({ ...liveRentals, integration_type: 'sandbox' })
    ).toBeNull();
    expect(
      snapshotFromLiveConfig({ ...liveRentals, access_token: null })
    ).toBeNull();
  });

  it('upserts on phone_number_id so a re-save refreshes the same profile', async () => {
    await upsertNumberProfile(makeDb(), {
      accountId: 'acc-1',
      userId: 'user-1',
      snapshot: snapshotFromLiveConfig(liveRentals)!,
      activatedAt: NOW,
    });
    const upsert = calls.find((c) => c.op === 'upsert');
    expect(upsert?.table).toBe('whatsapp_number_profiles');
    expect(upsert?.options).toEqual({ onConflict: 'phone_number_id' });
    expect(upsert?.payload).toMatchObject({
      account_id: 'acc-1',
      created_by: 'user-1',
      phone_number_id: 'pn-rentals',
      last_activated_at: NOW,
    });
    expect(upsert?.payload).not.toHaveProperty('label');
  });

  it('treats a number saved by another account as claimed even when it is not live there', async () => {
    queues.whatsapp_config = [{ data: null }];
    queues.whatsapp_number_profiles = [{ data: { account_id: 'acc-2' } }];
    await expect(
      isPhoneNumberClaimedElsewhere(makeDb(), 'pn-x', 'acc-1')
    ).resolves.toBe(true);
    for (const call of calls) {
      expect(call.filters).toContainEqual(['phone_number_id', 'eq', 'pn-x']);
      expect(call.filters).toContainEqual(['account_id', 'neq', 'acc-1']);
    }

    calls = [];
    queues.whatsapp_config = [{ data: null }];
    queues.whatsapp_number_profiles = [{ data: null }];
    await expect(
      isPhoneNumberClaimedElsewhere(makeDb(), 'pn-x', 'acc-1')
    ).resolves.toBe(false);
  });

  it('caps and trims labels', () => {
    expect(normalizeProfileLabel('  Sales desk  ')).toBe('Sales desk');
    expect(normalizeProfileLabel('x'.repeat(80))).toHaveLength(60);
    expect(normalizeProfileLabel(42)).toBe('');
  });
});

describe('[WAN-002] switching numbers reuses the saved registration', () => {
  it('marks only the Official API number that whatsapp_config carries as live', () => {
    expect(
      isProfileActive(salesProfile, {
        ...liveRentals,
        phone_number_id: 'pn-sales',
      })
    ).toBe(true);
    expect(isProfileActive(salesProfile, liveRentals)).toBe(false);
    expect(
      isProfileActive(salesProfile, {
        ...liveRentals,
        phone_number_id: 'pn-sales',
        integration_type: 'sandbox',
      })
    ).toBe(false);
    expect(isProfileActive(salesProfile, null)).toBe(false);
  });

  it('builds the live row from the profile without a fresh registration', () => {
    const row = liveConfigFromProfile(
      salesProfile,
      {
        id: 'pn-sales',
        display_phone_number: '+91 88000 00001',
        verified_name: 'PV',
      },
      NOW,
      NOW
    );
    expect(row).toMatchObject({
      integration_type: 'official_api',
      phone_number_id: 'pn-sales',
      access_token: 'enc:sales-token',
      registered_at: salesProfile.registered_at,
      subscribed_apps_at: NOW,
      last_registration_error: null,
      flows_key_registered_at: null,
      status: 'connected',
      connected_at: NOW,
    });
  });

  it('never returns the encrypted token in a summary', () => {
    const summary = summarizeProfile(salesProfile, liveRentals);
    expect(summary).not.toHaveProperty('access_token');
    expect(summary).not.toHaveProperty('verify_token');
    expect(summary.is_active).toBe(false);
  });

  it('activates a saved number: keeps the outgoing number saved, copies the profile into whatsapp_config, skips /register', async () => {
    queues.whatsapp_number_profiles = [
      { data: salesProfile },
      { data: null },
      { data: { ...salesProfile, last_activated_at: NOW } },
    ];
    queues.whatsapp_config = [
      { data: liveRentals },
      { data: [{ id: 'cfg-1' }] },
    ];
    const verify = vi.fn(async () => ({
      id: 'pn-sales',
      display_phone_number: '+91 88000 00001',
      verified_name: 'PV Realty Sales',
    }));
    const subscribe = vi.fn(async () => undefined);

    const result = await activateNumberProfile(makeDb(), {
      accountId: 'acc-1',
      userId: 'user-1',
      profileId: 'prof-sales',
      verify,
      subscribe,
      registrationState: cloudApiState,
      now: () => NOW,
    });

    expect(verify).toHaveBeenCalledWith({
      phoneNumberId: 'pn-sales',
      accessToken: 'sales-token',
    });
    expect(subscribe).toHaveBeenCalledWith({
      wabaId: 'waba-1',
      accessToken: 'sales-token',
    });

    const outgoing = calls.find(
      (c) => c.table === 'whatsapp_number_profiles' && c.op === 'upsert'
    );
    expect(outgoing?.payload).toMatchObject({
      phone_number_id: 'pn-rentals',
      access_token: 'enc:rentals-token',
      registered_at: liveRentals.registered_at,
    });

    const configWrite = calls.find(
      (c) => c.table === 'whatsapp_config' && c.op === 'update'
    );
    expect(configWrite?.filters).toContainEqual(['account_id', 'eq', 'acc-1']);
    expect(configWrite?.payload).toMatchObject({
      phone_number_id: 'pn-sales',
      access_token: 'enc:sales-token',
      waba_id: 'waba-1',
      registered_at: salesProfile.registered_at,
      integration_type: 'official_api',
      status: 'connected',
      previous_display_phone_number: '+91 88000 00002',
      number_changed_at: NOW,
    });
    expect(
      calls.some((c) => c.table === 'whatsapp_config' && c.op === 'insert')
    ).toBe(false);

    const stamp = calls.find(
      (c) => c.table === 'whatsapp_number_profiles' && c.op === 'update'
    );
    expect(stamp?.payload).toMatchObject({ last_activated_at: NOW });

    expect(result.already_active).toBe(false);
    expect(result.waba_changed).toBe(true);
    expect(result.profile.is_active).toBe(true);
    expect(result.profile).not.toHaveProperty('access_token');
  });

  it('[WAN-003] switches to a number Meta reports unregistered, but records it as such instead of trusting the saved registered_at', async () => {
    queues.whatsapp_number_profiles = [
      { data: salesProfile },
      { data: null },
      { data: { ...salesProfile, registered_at: null } },
    ];
    queues.whatsapp_config = [
      { data: liveRentals },
      { data: [{ id: 'cfg-1' }] },
    ];

    const result = await activateNumberProfile(makeDb(), {
      accountId: 'acc-1',
      userId: 'user-1',
      profileId: 'prof-sales',
      verify: async () => ({
        id: 'pn-sales',
        display_phone_number: '+91 88000 00001',
      }),
      subscribe: async () => undefined,
      registrationState: async () => ({
        status: 'PENDING',
        platformType: 'NOT_APPLICABLE',
        nameStatus: 'DECLINED',
        verifiedName: 'Aryavarta Realty',
        pinEnabled: false,
      }),
      now: () => NOW,
    });

    const configWrite = calls.find(
      (c) => c.table === 'whatsapp_config' && c.op === 'update'
    );
    expect(configWrite?.payload).toMatchObject({
      phone_number_id: 'pn-sales',
      registered_at: null,
      status: 'disconnected',
      connected_at: null,
    });
    expect(
      (configWrite?.payload as { last_registration_error: string })
        .last_registration_error
    ).toContain('declined the display name');

    const stamp = calls.find(
      (c) => c.table === 'whatsapp_number_profiles' && c.op === 'update'
    );
    expect(stamp?.payload).toMatchObject({ registered_at: null });

    expect(result.registered).toBe(false);
    expect(result.registration_error).toContain('two-step PIN');
  });

  it('[WAN-003] keeps the saved registration when Meta exposes no platform (test numbers)', async () => {
    queues.whatsapp_number_profiles = [
      { data: salesProfile },
      { data: null },
      { data: { ...salesProfile, last_activated_at: NOW } },
    ];
    queues.whatsapp_config = [
      { data: liveRentals },
      { data: [{ id: 'cfg-1' }] },
    ];

    const result = await activateNumberProfile(makeDb(), {
      accountId: 'acc-1',
      userId: 'user-1',
      profileId: 'prof-sales',
      verify: async () => ({
        id: 'pn-sales',
        display_phone_number: 'pn-sales',
      }),
      subscribe: async () => undefined,
      registrationState: async () => null,
      now: () => NOW,
    });

    const configWrite = calls.find(
      (c) => c.table === 'whatsapp_config' && c.op === 'update'
    );
    expect(configWrite?.payload).toMatchObject({
      registered_at: salesProfile.registered_at,
      last_registration_error: null,
      status: 'connected',
    });
    expect(result.registered).toBe(true);
  });

  it('[WAN-004] records no switch when the outgoing number has no dialable display number', async () => {
    queues.whatsapp_number_profiles = [
      { data: salesProfile },
      { data: null },
      { data: { ...salesProfile, last_activated_at: NOW } },
    ];
    queues.whatsapp_config = [
      { data: { ...liveRentals, display_phone_number: null } },
      { data: [{ id: 'cfg-1' }] },
    ];

    await activateNumberProfile(makeDb(), {
      accountId: 'acc-1',
      userId: 'user-1',
      profileId: 'prof-sales',
      verify: async () => ({
        id: 'pn-sales',
        display_phone_number: '+91 88000 00001',
      }),
      subscribe: async () => undefined,
      registrationState: cloudApiState,
      now: () => NOW,
    });

    const configWrite = calls.find(
      (c) => c.table === 'whatsapp_config' && c.op === 'update'
    );
    expect(configWrite?.payload).not.toHaveProperty('number_changed_at');
    expect(configWrite?.payload).not.toHaveProperty(
      'previous_display_phone_number'
    );
  });

  it('inserts a live row when the account has none', async () => {
    queues.whatsapp_number_profiles = [{ data: salesProfile }, { data: null }];
    queues.whatsapp_config = [{ data: null }, { data: null }];

    await activateNumberProfile(makeDb(), {
      accountId: 'acc-1',
      userId: 'user-1',
      profileId: 'prof-sales',
      verify: async () => ({
        id: 'pn-sales',
        display_phone_number: '+91 88000 00001',
      }),
      subscribe: async () => undefined,
      registrationState: cloudApiState,
      now: () => NOW,
    });

    const insert = calls.find(
      (c) => c.table === 'whatsapp_config' && c.op === 'insert'
    );
    expect(insert?.payload).toMatchObject({
      account_id: 'acc-1',
      user_id: 'user-1',
      phone_number_id: 'pn-sales',
    });
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it('is a no-op when the profile is already live', async () => {
    queues.whatsapp_number_profiles = [{ data: salesProfile }];
    queues.whatsapp_config = [
      { data: { ...liveRentals, phone_number_id: 'pn-sales' } },
    ];
    const verify = vi.fn();

    const result = await activateNumberProfile(makeDb(), {
      accountId: 'acc-1',
      userId: 'user-1',
      profileId: 'prof-sales',
      verify: verify as never,
      subscribe: vi.fn() as never,
    });

    expect(result.already_active).toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0);
  });

  it('refuses to switch when Meta rejects the saved token, leaving the live number untouched', async () => {
    queues.whatsapp_number_profiles = [{ data: salesProfile }, { data: null }];
    queues.whatsapp_config = [{ data: liveRentals }];

    await expect(
      activateNumberProfile(makeDb(), {
        accountId: 'acc-1',
        userId: 'user-1',
        profileId: 'prof-sales',
        verify: async () => {
          throw new Error('Invalid OAuth access token');
        },
        subscribe: vi.fn() as never,
      })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Invalid OAuth'),
    });

    expect(
      calls.some((c) => c.table === 'whatsapp_config' && c.op !== 'select')
    ).toBe(false);
  });

  it('refuses a profile whose token no longer decrypts', async () => {
    queues.whatsapp_number_profiles = [
      { data: { ...salesProfile, access_token: 'enc:broken' } },
      { data: null },
    ];
    queues.whatsapp_config = [{ data: liveRentals }];

    await expect(
      activateNumberProfile(makeDb(), {
        accountId: 'acc-1',
        userId: 'user-1',
        profileId: 'prof-sales',
        verify: vi.fn() as never,
        subscribe: vi.fn() as never,
      })
    ).rejects.toBeInstanceOf(UserFacingError);
  });

  it('will not delete the live number', async () => {
    queues.whatsapp_number_profiles = [{ data: salesProfile }];
    queues.whatsapp_config = [
      { data: { ...liveRentals, phone_number_id: 'pn-sales' } },
    ];

    await expect(
      deleteNumberProfile(makeDb(), {
        accountId: 'acc-1',
        profileId: 'prof-sales',
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(calls.some((c) => c.op === 'delete')).toBe(false);

    calls = [];
    queues.whatsapp_number_profiles = [{ data: salesProfile }, { data: null }];
    queues.whatsapp_config = [{ data: liveRentals }];
    await deleteNumberProfile(makeDb(), {
      accountId: 'acc-1',
      profileId: 'prof-sales',
    });
    const del = calls.find((c) => c.op === 'delete');
    expect(del?.filters).toContainEqual(['account_id', 'eq', 'acc-1']);
  });
});
