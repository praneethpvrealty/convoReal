import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({
  value: null as unknown,
  saves: 0,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({
        data: settings.value === null ? null : { value: settings.value },
        error: null,
      });
      builder.upsert = async (row: { value: unknown }) => {
        settings.value = JSON.parse(JSON.stringify(row.value));
        settings.saves += 1;
        return { error: null };
      };
      return builder;
    },
  }),
}));

const models = vi.hoisted(() => ({ configured: [] as string[] }));
vi.mock('@/lib/ai/gemini', () => ({
  configuredModels: () => models.configured,
}));

const pool = vi.hoisted(() => ({
  keys: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/ai/gemini-keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gemini-keys')>()),
  resolveGeminiKeys: async () => pool.keys,
}));

const alerts = vi.hoisted(() => ({
  alertModelLifecycle: vi.fn(async () => true),
}));
vi.mock('./key-alerts', () => alerts);

import { checkModelLifecycle } from './model-lifecycle-check';
import {
  applyModelLifecycle,
  parseModelLifecycle,
  resetModelLifecycleCache,
  successorFromMessage,
} from './model-lifecycle';

const RETIRED_25 =
  'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features.';

const responses: Record<string, { status: number; message?: string }> = {};

function key(label: string) {
  return {
    id: `id-${label}`,
    label,
    key: label,
    scope: 'general',
    restingUntil: 0,
    lastError: null,
  };
}

beforeEach(() => {
  settings.value = null;
  settings.saves = 0;
  models.configured = ['gemini-2.5-flash', 'gemini-3.6-flash'];
  pool.keys = [key('key-a')];
  alerts.alertModelLifecycle.mockClear();
  resetModelLifecycleCache();
  for (const model of Object.keys(responses)) delete responses[model];
  vi.stubGlobal('fetch', async (url: string) => {
    const apiKey = new URL(url).searchParams.get('key') ?? '';
    const model = url.split('/models/')[1]?.split(':')[0] ?? '';
    const response = responses[`${apiKey}:${model}`] ??
      responses[model] ?? { status: 200 };
    return new Response(
      JSON.stringify(
        response.status === 200
          ? { candidates: [{ content: { parts: [{ text: 'OK' }] } }] }
          : { error: { message: response.message } }
      ),
      { status: response.status }
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applyModelLifecycle', () => {
  it('[AIK-008] swaps a retired model for its successor and follows successors onward', () => {
    const state = parseModelLifecycle({
      retired: {
        'gemini-2.5-flash': { replacement: 'gemini-3.8-flash' },
        'gemini-3.8-flash': { replacement: 'gemini-4-flash' },
        'gemini-3.1-flash-lite': { replacement: null },
      },
    });
    expect(
      applyModelLifecycle(
        ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-4-flash'],
        state
      )
    ).toEqual(['gemini-4-flash']);
    expect(
      applyModelLifecycle(['gemini-2.5-flash', 'gemini-3.6-flash'], state)
    ).toEqual(['gemini-4-flash', 'gemini-3.6-flash']);
  });

  it('[AIK-008] never empties a chain', () => {
    const state = parseModelLifecycle({
      retired: { 'gemini-3.6-flash': { replacement: null } },
    });
    expect(applyModelLifecycle(['gemini-3.6-flash'], state)).toEqual([
      'gemini-3.6-flash',
    ]);
  });

  it('[AIK-008] reads the successor Google names and ignores non-text models', () => {
    expect(successorFromMessage(RETIRED_25, 'gemini-2.5-flash')).toBe(
      'gemini-3.8-flash'
    );
    expect(
      successorFromMessage(
        'Please update your code to use models/gemini-3.8-flash-tts.',
        'gemini-2.5-flash'
      )
    ).toBeNull();
    expect(
      successorFromMessage('models/gemini-2.5-flash is not found', 'x')
    ).toBeNull();
    expect(parseModelLifecycle('junk')).toEqual({
      retired: {},
      checkedAt: null,
    });
  });
});

describe('checkModelLifecycle', () => {
  it('[AIK-008] retires a dead model, adopts the successor once it answers, and alerts', async () => {
    responses['gemini-2.5-flash'] = { status: 404, message: RETIRED_25 };
    const report = await checkModelLifecycle(new Date('2026-09-26T02:20:00Z'));
    expect(report.retired).toEqual([
      { model: 'gemini-2.5-flash', replacement: 'gemini-3.8-flash' },
    ]);
    expect(report.probed['gemini-3.8-flash']).toBe('ok');
    const state = parseModelLifecycle(settings.value);
    expect(
      applyModelLifecycle(['gemini-2.5-flash', 'gemini-3.6-flash'], state)
    ).toEqual(['gemini-3.8-flash', 'gemini-3.6-flash']);
    expect(alerts.alertModelLifecycle).toHaveBeenCalledWith(report.retired, []);

    alerts.alertModelLifecycle.mockClear();
    const again = await checkModelLifecycle(new Date('2026-09-27T02:20:00Z'));
    expect(again.retired).toEqual([]);
    expect(alerts.alertModelLifecycle).not.toHaveBeenCalled();
    expect(
      parseModelLifecycle(settings.value).retired['gemini-2.5-flash'].retiredAt
    ).toBe('2026-09-26T02:20:00.000Z');
  });

  it('[AIK-008] drops a dead model without adopting a successor that does not answer', async () => {
    responses['gemini-2.5-flash'] = { status: 404, message: RETIRED_25 };
    responses['gemini-3.8-flash'] = {
      status: 400,
      message: 'Request contains an invalid argument.',
    };
    const report = await checkModelLifecycle();
    expect(report.retired).toEqual([
      { model: 'gemini-2.5-flash', replacement: null },
    ]);
    expect(
      applyModelLifecycle(
        ['gemini-2.5-flash', 'gemini-3.6-flash'],
        parseModelLifecycle(settings.value)
      )
    ).toEqual(['gemini-3.6-flash']);
  });

  it('[AIK-008] keeps a model that any key can still call', async () => {
    pool.keys = [key('key-a'), key('key-b')];
    responses['key-a:gemini-2.5-flash'] = { status: 404, message: RETIRED_25 };
    const report = await checkModelLifecycle();
    expect(report.retired).toEqual([]);
    expect(report.probed['gemini-2.5-flash']).toBe('ok');
  });

  it('[AIK-008] leaves the record alone when a probe is inconclusive and restores a model that answers again', async () => {
    settings.value = {
      retired: {
        'gemini-2.5-flash': {
          retiredAt: '2026-09-26T02:20:00.000Z',
          replacement: 'gemini-3.8-flash',
          message: RETIRED_25,
        },
      },
      checkedAt: null,
    };
    responses['gemini-2.5-flash'] = {
      status: 429,
      message: 'You exceeded your current quota, please check your plan.',
    };
    const quiet = await checkModelLifecycle();
    expect(quiet.retired).toEqual([]);
    expect(quiet.restored).toEqual([]);
    expect(
      parseModelLifecycle(settings.value).retired['gemini-2.5-flash']
    ).toBeDefined();
    expect(alerts.alertModelLifecycle).not.toHaveBeenCalled();

    delete responses['gemini-2.5-flash'];
    const back = await checkModelLifecycle();
    expect(back.restored).toEqual(['gemini-2.5-flash']);
    expect(parseModelLifecycle(settings.value).retired).toEqual({});
    expect(alerts.alertModelLifecycle).toHaveBeenCalledWith(
      [],
      ['gemini-2.5-flash']
    );
  });

  it('[AIK-008] skips without writing when no key is ready', async () => {
    pool.keys = [];
    const report = await checkModelLifecycle();
    expect(report.skipped).toBe('No ready Gemini key');
    expect(settings.saves).toBe(0);
  });
});
