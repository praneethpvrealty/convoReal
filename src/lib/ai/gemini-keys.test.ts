import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./call-log', () => ({ logAiCall: vi.fn() }));

import {
  classifyGeminiKeyFailure,
  generateText,
  geminiKeyPool,
  resetGeminiKeyCooldowns,
} from './gemini';

const failures: Record<string, string> = {};
const seen: string[] = [];

beforeEach(() => {
  resetGeminiKeyCooldowns();
  seen.length = 0;
  for (const key of Object.keys(failures)) delete failures[key];
  vi.stubEnv('GEMINI_API_KEY', 'key-a');
  vi.stubEnv('GEMINI_FALLBACK_API_KEYS', 'key-b, key-c');
  vi.stubGlobal('fetch', async (url: string) => {
    const key = new URL(url).searchParams.get('key') ?? '';
    seen.push(key);
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

describe('Gemini key pool', () => {
  it('[GVL-010] moves to the next key when one runs out of credits', async () => {
    failures['key-a'] = 'Your prepayment credits are depleted.';
    expect(await generateText('hi')).toBe('ok from key-b');
    expect(seen).toEqual(['key-a', 'key-b']);
  });

  it('[GVL-010] sets a key that ran out aside on the following calls', async () => {
    failures['key-a'] = 'Your prepayment credits are depleted.';
    await generateText('hi');
    seen.length = 0;
    expect(await generateText('again')).toBe('ok from key-b');
    expect(seen).toEqual(['key-b']);
    expect(geminiKeyPool()).toEqual(['key-b', 'key-c']);
  });

  it('does not switch keys for an ordinary model error', async () => {
    failures['key-a'] = 'Request contains an invalid argument.';
    await expect(generateText('hi')).rejects.toThrow(/invalid argument/);
    expect(seen).toEqual(['key-a']);
  });

  it('reports the last failure when every key is out', async () => {
    failures['key-a'] = 'Your prepayment credits are depleted.';
    failures['key-b'] = 'API key not valid. Please pass a valid API key.';
    failures['key-c'] = 'Your prepayment credits are depleted.';
    await expect(generateText('hi')).rejects.toThrow(/credits are depleted/);
  });

  it('[GVL-010] never calls a resting key while every key is set aside', async () => {
    failures['key-a'] = 'Your prepayment credits are depleted.';
    failures['key-b'] = 'Resource has been exhausted (e.g. check quota).';
    failures['key-c'] = 'Your prepayment credits are depleted.';
    await expect(generateText('hi')).rejects.toThrow();
    seen.length = 0;
    await expect(generateText('again')).rejects.toThrow(/exhausted/);
    expect(seen).toEqual([]);
  });

  it('uses only the override keys for a feature billed separately', () => {
    expect(geminiKeyPool('imp-1,imp-2')).toEqual(['imp-1', 'imp-2']);
    expect(geminiKeyPool()).toEqual(['key-a', 'key-b', 'key-c']);
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
