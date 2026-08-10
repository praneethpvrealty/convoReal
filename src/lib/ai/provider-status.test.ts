import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getImageProvidersStatus } from './provider-status';

const KEYS = ['HF_ACCESS_TOKEN', 'GEMINI_API_KEY', 'STABILITY_API_KEY', 'NEXT_PUBLIC_SELF_HOSTED'];

describe('getImageProvidersStatus', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it('marks a provider available only when its key is set', () => {
    process.env.STABILITY_API_KEY = 'sk-test';

    const { providers } = getImageProvidersStatus();

    expect(providers.find((p) => p.id === 'stability')?.available).toBe(true);
    expect(providers.find((p) => p.id === 'google')?.available).toBe(false);
    expect(providers.find((p) => p.id === 'huggingface')?.available).toBe(false);
  });

  it('withholds env var names on the managed deployment', () => {
    process.env.GEMINI_API_KEY = 'g-test';

    const { selfHosted, providers } = getImageProvidersStatus();

    expect(selfHosted).toBe(false);
    expect(providers.every((p) => p.envVar === undefined)).toBe(true);
  });

  it('exposes env var names when self-hosted', () => {
    process.env.NEXT_PUBLIC_SELF_HOSTED = 'true';

    const { selfHosted, providers } = getImageProvidersStatus();

    expect(selfHosted).toBe(true);
    expect(providers.find((p) => p.id === 'huggingface')?.envVar).toBe('HF_ACCESS_TOKEN');
  });
});
