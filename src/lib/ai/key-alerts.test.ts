import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  keyRow: { last_alert_at: null as string | null },
  settings: null as Record<string, string> | null,
  admins: [
    { user_id: 'u1', account_id: 'acc-1' },
    { user_id: 'u2', account_id: 'acc-2' },
  ],
  keyUpdates: [] as Record<string, unknown>[],
  settingWrites: [] as Record<string, unknown>[],
}));

const notify = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('@/lib/notifications/create', () => ({ createNotification: notify }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      let pendingUpdate: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => {
        if (pendingUpdate) {
          store.keyUpdates.push(pendingUpdate);
          store.keyRow.last_alert_at = pendingUpdate.last_alert_at as string;
          pendingUpdate = null;
        }
        return builder;
      };
      builder.update = (patch: Record<string, unknown>) => {
        pendingUpdate = patch;
        return builder;
      };
      builder.maybeSingle = async () => ({
        data:
          table === 'ai_provider_keys'
            ? store.keyRow
            : store.settings
              ? { value: store.settings }
              : null,
        error: null,
      });
      builder.upsert = async (row: { value: Record<string, string> }) => {
        store.settingWrites.push(row);
        store.settings = row.value;
        return { error: null };
      };
      builder.then = (
        resolve: (value: { data: unknown; error: null }) => void
      ) =>
        resolve({
          data: table === 'profiles' ? store.admins : [],
          error: null,
        });
      return builder;
    },
  }),
}));

import {
  ALERT_COOLDOWN_MS,
  alertAllKeysResting,
  alertKeyExhausted,
  resetKeyAlertState,
  shouldAlert,
} from './key-alerts';

beforeEach(() => {
  resetKeyAlertState();
  notify.mockClear();
  store.keyRow = { last_alert_at: null };
  store.settings = null;
  store.keyUpdates = [];
  store.settingWrites = [];
});

describe('shouldAlert', () => {
  it('[AIK-005] alerts once per cooldown window', () => {
    const now = Date.now();
    expect(shouldAlert(null, now)).toBe(true);
    expect(shouldAlert(new Date(now - 60_000).toISOString(), now)).toBe(false);
    expect(
      shouldAlert(new Date(now - ALERT_COOLDOWN_MS - 1).toISOString(), now)
    ).toBe(true);
  });
});

describe('alertKeyExhausted', () => {
  it('[AIK-005] tells every platform admin on all channels, once', async () => {
    const entry = {
      id: 'k1',
      label: 'pransss@gmail.com',
      scope: 'general' as const,
    };
    expect(
      await alertKeyExhausted(entry, 'Your prepayment credits are depleted.')
    ).toBe(true);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        userId: 'u1',
        type: 'ai_key_alert',
        title: 'Gemini key "pransss@gmail.com" has run out',
        channels: { inApp: true, whatsapp: true, push: true },
      })
    );
    expect(store.keyUpdates[0]).toHaveProperty('last_alert_at');

    resetKeyAlertState();
    expect(await alertKeyExhausted(entry, 'again')).toBe(false);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('[AIK-005] dedupes environment keys through system_settings', async () => {
    const entry = { id: null, label: 'primary', scope: 'general' as const };
    expect(await alertKeyExhausted(entry, 'depleted')).toBe(true);
    expect(store.settingWrites[0]).toMatchObject({ key: 'ai_key_alerts' });
    expect(store.settings?.['key:primary']).toBeTruthy();
    resetKeyAlertState();
    expect(await alertKeyExhausted(entry, 'depleted')).toBe(false);
  });
});

describe('alertAllKeysResting', () => {
  it('[AIK-005] raises one alert naming every key', async () => {
    expect(await alertAllKeysResting(['a', 'b'], 'quota')).toBe(true);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Every Gemini key is resting',
        body: expect.stringContaining('Keys: a, b'),
      })
    );
    expect(await alertAllKeysResting(['a', 'b'], 'quota')).toBe(false);
  });
});
