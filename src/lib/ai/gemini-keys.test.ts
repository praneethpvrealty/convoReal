import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encrypt } from '@/lib/whatsapp/encryption';

vi.mock('./call-log', () => ({ logAiCall: vi.fn() }));

const alerts = vi.hoisted(() => ({
  alertKeyExhausted: vi.fn(async () => true),
  alertAllKeysResting: vi.fn(async () => true),
}));
vi.mock('./key-alerts', () => alerts);

const store = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  fail: false,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      let pendingPatch: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.order = chain;
      builder.update = (patch: Record<string, unknown>) => {
        pendingPatch = patch;
        return builder;
      };
      builder.eq = (column: string, value: unknown) => {
        if (pendingPatch && column === 'id') {
          store.updates.push({ id: String(value), patch: pendingPatch });
          pendingPatch = null;
        }
        return builder;
      };
      builder.then = (
        resolve: (value: { data: unknown; error: unknown }) => void
      ) =>
        resolve(
          store.fail
            ? { data: null, error: { message: 'connection refused' } }
            : { data: store.rows, error: null }
        );
      return builder;
    },
  }),
}));

import {
  classifyGeminiKeyFailure,
  generateText,
  resetGeminiKeyState,
} from './gemini';
import {
  markModelRetired,
  parseEnvKeys,
  resolveGeminiKeys,
  usableModels,
} from './gemini-keys';

const failures: Record<string, string> = {};
const modelFailures: Record<string, { status: number; message: string }> = {};
const seen: string[] = [];
const seenModels: string[] = [];

function managedRow(
  label: string,
  key: string,
  extra: Record<string, unknown> = {}
) {
  return {
    id: `id-${label}`,
    label,
    key_ciphertext: encrypt(key),
    scope: 'general',
    resting_until: null,
    last_error: null,
    ...extra,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetGeminiKeyState();
  seen.length = 0;
  seenModels.length = 0;
  for (const key of Object.keys(modelFailures)) delete modelFailures[key];
  store.rows = [];
  store.updates = [];
  store.fail = false;
  alerts.alertKeyExhausted.mockClear();
  alerts.alertAllKeysResting.mockClear();
  for (const key of Object.keys(failures)) delete failures[key];
  vi.stubEnv('GEMINI_API_KEY', 'env-a');
  vi.stubEnv('GEMINI_FALLBACK_API_KEYS', 'spare=env-b, env-c');
  vi.stubEnv('GEMINI_IMPORT_API_KEY', '');
  vi.stubGlobal('fetch', async (url: string) => {
    const key = new URL(url).searchParams.get('key') ?? '';
    const model = url.split('/models/')[1]?.split(':')[0] ?? '';
    seen.push(key);
    seenModels.push(model);
    const modelFailure = modelFailures[`${key}:${model}`];
    if (modelFailure) {
      return new Response(
        JSON.stringify({ error: { message: modelFailure.message } }),
        { status: modelFailure.status }
      );
    }
    if (failures[key]) {
      return new Response(
        JSON.stringify({ error: { message: failures[key] } }),
        { status: 400 }
      );
    }
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: `ok from ${key}` }] } }],
      }),
      { status: 200 }
    );
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('parseEnvKeys', () => {
  it('[AIK-001] reads label=key entries and falls back to positional labels', () => {
    const keys = parseEnvKeys(
      'praneeku@gmail.com=k1, k2,,third=k3',
      (i) => `fallback-${i + 1}`,
      'general'
    );
    expect(keys.map((k) => [k.label, k.key])).toEqual([
      ['praneeku@gmail.com', 'k1'],
      ['fallback-2', 'k2'],
      ['third', 'k3'],
    ]);
  });
});

describe('key pool', () => {
  it('[AIK-001] prefers managed keys over the environment', async () => {
    store.rows = [managedRow('pransss@gmail.com', 'db-a')];
    expect(await generateText('hi')).toBe('ok from db-a');
    expect(seen).toEqual(['db-a']);
  });

  it('[AIK-001] uses environment keys with their labels when none are managed', async () => {
    const keys = await resolveGeminiKeys({});
    expect(keys.map((k) => [k.label, k.key])).toEqual([
      ['primary', 'env-a'],
      ['spare', 'env-b'],
      ['fallback-2', 'env-c'],
    ]);
  });

  it('[AIK-001] falls back to the environment when the key table is unreachable', async () => {
    store.fail = true;
    expect(await generateText('hi')).toBe('ok from env-a');
  });

  it('[AIK-001] [GVL-010] gives import-scoped keys to the import and general keys to everything else', async () => {
    store.rows = [
      managedRow('main', 'db-a'),
      managedRow('imports', 'db-imp', { scope: 'import' }),
    ];
    expect(
      (await resolveGeminiKeys({ scope: 'import' })).map((k) => k.key)
    ).toEqual(['db-imp']);
    expect((await resolveGeminiKeys({})).map((k) => k.key)).toEqual(['db-a']);
  });

  it('[AIK-001] keeps ordinary calls on the environment when only import keys are managed', async () => {
    store.rows = [managedRow('imports', 'db-imp', { scope: 'import' })];
    expect(await generateText('hi')).toBe('ok from env-a');
    expect(
      (await resolveGeminiKeys({ scope: 'import' })).map((k) => k.key)
    ).toEqual(['db-imp']);
  });

  it('[AIK-001] lets the import share general keys when no import key exists', async () => {
    store.rows = [managedRow('main', 'db-a')];
    expect(
      (await resolveGeminiKeys({ scope: 'import' })).map((k) => k.key)
    ).toEqual(['db-a']);
  });
});

describe('failover', () => {
  it('[AIK-002] moves to the next key when one runs out of credits', async () => {
    failures['env-a'] = 'Your prepayment credits are depleted.';
    expect(await generateText('hi')).toBe('ok from env-b');
    expect(seen).toEqual(['env-a', 'env-b']);
  });

  it('[AIK-002] sets an exhausted key aside on the following calls', async () => {
    failures['env-a'] = 'Your prepayment credits are depleted.';
    await generateText('hi');
    seen.length = 0;
    expect(await generateText('again')).toBe('ok from env-b');
    expect(seen).toEqual(['env-b']);
  });

  it('[AIK-002] never calls a resting key while every key is set aside', async () => {
    failures['env-a'] = 'Your prepayment credits are depleted.';
    failures['env-b'] = 'Resource has been exhausted (e.g. check quota).';
    failures['env-c'] = 'Your prepayment credits are depleted.';
    await expect(generateText('hi')).rejects.toThrow();
    seen.length = 0;
    await expect(generateText('again')).rejects.toThrow(/exhausted/);
    expect(seen).toEqual([]);
  });

  it('[AIK-002] records the rest on the managed key row so every instance sees it', async () => {
    store.rows = [managedRow('first', 'db-a'), managedRow('second', 'db-b')];
    failures['db-a'] = 'Your prepayment credits are depleted.';
    expect(await generateText('hi')).toBe('ok from db-b');
    await tick();
    const rest = store.updates.find((u) => u.id === 'id-first');
    expect(rest?.patch).toMatchObject({
      last_error: 'Your prepayment credits are depleted.',
    });
    expect(typeof rest?.patch.resting_until).toBe('string');
  });

  it('[AIK-002] honours a rest recorded by another instance', async () => {
    store.rows = [
      managedRow('first', 'db-a', {
        resting_until: new Date(Date.now() + 60_000).toISOString(),
      }),
      managedRow('second', 'db-b'),
    ];
    expect(await generateText('hi')).toBe('ok from db-b');
    expect(seen).toEqual(['db-b']);
  });

  it('[AIK-005] alerts platform admins when a key runs out, not on a rate limit', async () => {
    failures['env-a'] = 'Your prepayment credits are depleted.';
    failures['env-b'] = 'Resource has been exhausted (e.g. check quota).';
    expect(await generateText('hi')).toBe('ok from env-c');
    await tick();
    expect(alerts.alertKeyExhausted).toHaveBeenCalledTimes(1);
    expect(alerts.alertKeyExhausted).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'primary' }),
      'Your prepayment credits are depleted.'
    );
  });

  it('[AIK-005] alerts once every key is resting', async () => {
    failures['env-a'] = 'Your prepayment credits are depleted.';
    failures['env-b'] = 'Your prepayment credits are depleted.';
    failures['env-c'] = 'Your prepayment credits are depleted.';
    await expect(generateText('hi')).rejects.toThrow();
    await expect(generateText('again')).rejects.toThrow();
    await tick();
    expect(alerts.alertAllKeysResting).toHaveBeenCalledWith(
      ['primary', 'spare', 'fallback-2'],
      expect.stringContaining('depleted')
    );
  });

  it('[AIK-002] sees a rest recorded by another instance within the cache window', async () => {
    store.rows = [managedRow('first', 'db-a'), managedRow('second', 'db-b')];
    expect(await generateText('hi')).toBe('ok from db-a');
    store.rows = [
      managedRow('first', 'db-a', {
        resting_until: new Date(Date.now() + 60_000).toISOString(),
        last_error: 'Your prepayment credits are depleted.',
      }),
      managedRow('second', 'db-b'),
    ];
    seen.length = 0;
    expect(await generateText('again')).toBe('ok from db-b');
    expect(seen).toEqual(['db-b']);
  });

  it('[AIK-002] keeps the persisted failure when every key was rested elsewhere', async () => {
    store.rows = [
      managedRow('only', 'db-a', {
        resting_until: new Date(Date.now() + 60_000).toISOString(),
        last_error: 'You exceeded your current quota.',
      }),
    ];
    await expect(generateText('hi')).rejects.toThrow(
      /exceeded your current quota/
    );
    expect(seen).toEqual([]);
  });

  it('does not switch keys for an ordinary model error', async () => {
    failures['env-a'] = 'Request contains an invalid argument.';
    await expect(generateText('hi')).rejects.toThrow(/invalid argument/);
    expect(seen).toEqual(['env-a']);
  });
});

describe('retired models', () => {
  const retired = {
    status: 404,
    message:
      'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash.',
  };

  it('[AIK-007] moves past a model Google retired for the key and skips it afterwards', async () => {
    modelFailures['env-a:gemini-2.5-flash'] = retired;
    expect(await generateText('hi')).toBe('ok from env-a');
    expect(seenModels).toEqual(['gemini-2.5-flash', 'gemini-3.5-flash']);
    seenModels.length = 0;
    expect(await generateText('again')).toBe('ok from env-a');
    expect(seenModels).toEqual(['gemini-3.5-flash']);
  });

  it('[AIK-007] lets the lite tier reach full Flash when lite is over quota and the fallback is retired', async () => {
    modelFailures['env-a:gemini-3.1-flash-lite'] = {
      status: 429,
      message: 'You exceeded your current quota, please check your plan.',
    };
    modelFailures['env-a:gemini-3.5-flash-lite'] = {
      status: 429,
      message: 'You exceeded your current quota, please check your plan.',
    };
    modelFailures['env-a:gemini-2.5-flash'] = retired;
    expect(await generateText('hi', undefined, { tier: 'lite' })).toBe(
      'ok from env-a'
    );
    expect(seenModels).toEqual([
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-3.5-flash',
    ]);
  });

  it('[AIK-007] moves to the next key when every model is retired for one key', async () => {
    modelFailures['env-a:gemini-2.5-flash'] = retired;
    modelFailures['env-a:gemini-3.5-flash'] = retired;
    modelFailures['env-a:gemini-3.6-flash'] = retired;
    expect(await generateText('hi')).toBe('ok from env-b');
    expect(seen).toEqual(['env-a', 'env-a', 'env-a', 'env-b']);
  });

  it('[AIK-007] reaches gemini-3.6-flash when the earlier full-Flash models are over quota', async () => {
    modelFailures['env-a:gemini-2.5-flash'] = retired;
    modelFailures['env-a:gemini-3.5-flash'] = {
      status: 429,
      message: 'You exceeded your current quota, please check your plan.',
    };
    expect(await generateText('hi')).toBe('ok from env-a');
    expect(seenModels).toEqual([
      'gemini-2.5-flash',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
    ]);
  });

  it('[AIK-007] retires a model for that key only', () => {
    const [a, b] = parseEnvKeys('a=key-a, b=key-b', (i) => `k${i}`, 'general');
    const chain = ['gemini-2.5-flash', 'gemini-3.5-flash'];
    markModelRetired(a, 'gemini-2.5-flash');
    expect(usableModels(a, chain)).toEqual(['gemini-3.5-flash']);
    expect(usableModels(b, chain)).toEqual(chain);
    markModelRetired(a, 'gemini-3.5-flash');
    expect(usableModels(a, chain)).toEqual(chain);
  });
});

describe('classifyGeminiKeyFailure', () => {
  it('separates exhausted keys from rate limits', () => {
    expect(
      classifyGeminiKeyFailure('Your prepayment credits are depleted.')
    ).toBe('exhausted');
    expect(
      classifyGeminiKeyFailure(
        'You exceeded your current quota, please check your plan and billing details.'
      )
    ).toBe('rate_limited');
    expect(
      classifyGeminiKeyFailure('Failed to parse Gemini response')
    ).toBeNull();
  });
});
