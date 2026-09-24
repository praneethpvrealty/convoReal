import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRICING,
  KEY_COLUMNS,
  KeyInputError,
  buildKeyDashboard,
  estimateCostUsd,
  kolkataDate,
  mergePricing,
  usageWindowDays,
  validateKeyInput,
  validateTopup,
  type DailyUsageRow,
  type ManagedKeyRow,
} from './keys-admin';

const NOW = new Date('2026-09-24T06:30:00Z');
const TODAY = kolkataDate(NOW);

function usage(
  key_label: string,
  day: string,
  extra: Partial<DailyUsageRow> = {}
): DailyUsageRow {
  return {
    day,
    key_label,
    model: 'gemini-2.5-flash',
    feature: 'chatbot',
    calls: 10,
    failures: 0,
    prompt_tokens: 1_000_000,
    response_tokens: 100_000,
    ...extra,
  };
}

function key(label: string, extra: Partial<ManagedKeyRow> = {}): ManagedKeyRow {
  return {
    id: `id-${label}`,
    label,
    key_hint: '…abcd',
    scope: 'general',
    priority: 0,
    enabled: true,
    resting_until: null,
    last_error: null,
    last_error_at: null,
    last_used_at: null,
    created_at: '2026-09-01T00:00:00Z',
    ...extra,
  };
}

describe('pricing', () => {
  it('[AIK-004] prices unknown models by family and merges overrides', () => {
    const pricing = mergePricing({
      models: {
        'gemini-2.5-flash': { input: 1, output: 2 },
        bad: { input: -1 },
      },
      inrPerUsd: 90,
    });
    expect(pricing.models['gemini-2.5-flash']).toEqual({ input: 1, output: 2 });
    expect(pricing.models.bad).toBeUndefined();
    expect(pricing.inrPerUsd).toBe(90);
    expect(
      estimateCostUsd('gemini-9-flash-lite', 1_000_000, 0, DEFAULT_PRICING)
    ).toBe(DEFAULT_PRICING.models['gemini-2.5-flash-lite'].input);
    expect(
      estimateCostUsd('gemini-2.5-flash', 1_000_000, 1_000_000, pricing)
    ).toBe(3);
  });
});

describe('validation', () => {
  it('[AIK-003] refuses junk keys and labels', () => {
    expect(() =>
      validateKeyInput({ label: 'x', key: 'AIzaValidLooking_key-1234567' })
    ).toThrow(KeyInputError);
    expect(() =>
      validateKeyInput({
        label: 'ok label',
        key: 'has a space in it 0123456789',
      })
    ).toThrow(KeyInputError);
    expect(
      validateKeyInput({
        label: 'ok label',
        key: 'AQ.Ab8RN6Lq-example.Key_material-0123',
      }).key
    ).toBe('AQ.Ab8RN6Lq-example.Key_material-0123');
    expect(() => validateKeyInput({ label: 'ok label', key: 'short' })).toThrow(
      KeyInputError
    );
    expect(
      validateKeyInput({
        label: ' praneeku@gmail.com ',
        key: 'AIzaValidLooking_key-1234567',
        scope: 'import',
        priority: '5',
      })
    ).toEqual({
      label: 'praneeku@gmail.com',
      key: 'AIzaValidLooking_key-1234567',
      scope: 'import',
      priority: 5,
    });
  });

  it('[AIK-003] the admin projection never includes key material', () => {
    expect(KEY_COLUMNS).not.toMatch(/ciphertext/);
    expect(KEY_COLUMNS).toMatch(/key_hint/);
  });

  it('rejects a top-up without an amount or in the future', () => {
    expect(() => validateTopup({ amount: 0 })).toThrow(KeyInputError);
    expect(() =>
      validateTopup({ amount: 100, topped_up_at: '2099-01-01' })
    ).toThrow(KeyInputError);
    expect(
      validateTopup({ amount: '1500.555', currency: 'INR' })
    ).toMatchObject({
      amount: 1500.56,
      currency: 'INR',
    });
  });
});

describe('buildKeyDashboard', () => {
  it('[AIK-004] splits usage into today, month and since the last top-up, and estimates what is left', () => {
    const monthStart = TODAY.slice(0, 8) + '01';
    const lastMonth = '2026-08-30';
    const dashboard = buildKeyDashboard({
      keys: [key('main')],
      topups: [
        {
          id: 't1',
          key_id: 'id-main',
          amount: 1000,
          currency: 'INR',
          topped_up_at: `${monthStart}T00:00:00+05:30`,
          note: null,
        },
        {
          id: 't0',
          key_id: 'id-main',
          amount: 5,
          currency: 'USD',
          topped_up_at: '2026-07-01T00:00:00Z',
          note: null,
        },
      ],
      usage: [
        usage('main', TODAY),
        usage('main', monthStart),
        usage('main', lastMonth),
      ],
      pricing: { ...DEFAULT_PRICING, inrPerUsd: 100 },
      days: 30,
      now: NOW,
    });
    const main = dashboard.keys[0];
    const perRow = 0.3 + 0.25;
    expect(main.today.costUsd).toBeCloseTo(perRow);
    expect(main.today.calls).toBe(10);
    expect(main.month.costUsd).toBeCloseTo(
      monthStart === TODAY ? perRow : perRow * 2
    );
    expect(main.lastTopup?.id).toBe('t1');
    expect(main.sinceTopup?.costUsd).toBeCloseTo(main.month.costUsd);
    expect(main.estimatedRemaining).toMatchObject({
      amount: Math.round((1000 - main.month.costUsd * 100) * 100) / 100,
      currency: 'INR',
    });
    expect(main.status).toBe('active');
  });

  it('[AIK-004] lists labels seen in the log but not managed, and marks resting and disabled keys', () => {
    const dashboard = buildKeyDashboard({
      keys: [
        key('resting', {
          resting_until: new Date(NOW.getTime() + 60_000).toISOString(),
        }),
        key('off', { enabled: false }),
        key('stale', {
          resting_until: new Date(NOW.getTime() - 60_000).toISOString(),
        }),
      ],
      topups: [],
      usage: [usage('primary', TODAY, { model: 'gemini-3.1-flash-lite' })],
      pricing: DEFAULT_PRICING,
      days: 30,
      now: NOW,
    });
    const byLabel = Object.fromEntries(dashboard.keys.map((k) => [k.label, k]));
    expect(byLabel.resting.status).toBe('resting');
    expect(byLabel.off.status).toBe('disabled');
    expect(byLabel.stale.status).toBe('active');
    expect(byLabel.primary).toMatchObject({
      managed: false,
      status: 'unmanaged',
    });
    expect(byLabel.primary.today.costUsd).toBeCloseTo(0.1 + 0.04);
    expect(dashboard.daily.byKey).toHaveLength(30);
    expect(dashboard.daily.byKey.at(-1)).toMatchObject({ day: TODAY });
    expect(dashboard.daily.keyLabels).toEqual(['primary']);
  });
});

describe('usage window', () => {
  it('[AIK-004] reaches back to the month start and the last top-up, capped at 90 days', () => {
    const now = new Date('2026-09-24T06:30:00Z');
    expect(usageWindowDays(30, [], now)).toBe(30);
    expect(
      usageWindowDays(
        7,
        [
          {
            id: 't',
            key_id: 'k',
            amount: 1,
            currency: 'USD',
            topped_up_at: '2026-08-01T00:00:00Z',
            note: null,
          },
        ],
        now
      )
    ).toBe(56);
    expect(
      usageWindowDays(
        7,
        [
          {
            id: 't',
            key_id: 'k',
            amount: 1,
            currency: 'USD',
            topped_up_at: '2026-01-01T00:00:00Z',
            note: null,
          },
        ],
        now
      )
    ).toBe(90);
  });

  it('[AIK-004] marks the remaining estimate partial when the top-up predates the log window', () => {
    const dashboard = buildKeyDashboard({
      keys: [key('main')],
      topups: [
        {
          id: 't',
          key_id: 'id-main',
          amount: 100,
          currency: 'USD',
          topped_up_at: '2026-01-01T00:00:00Z',
          note: null,
        },
      ],
      usage: [usage('main', TODAY)],
      pricing: DEFAULT_PRICING,
      days: 30,
      usageDays: 90,
      now: NOW,
    });
    expect(dashboard.keys[0].estimatedRemaining).toMatchObject({
      partial: true,
      currency: 'USD',
    });
    expect(dashboard.usageDays).toBe(90);
  });
});
