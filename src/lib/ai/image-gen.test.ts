import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateWithStability,
  generateAiImage,
  hasImageProvider,
  IMAGE_PROVIDER_UNAVAILABLE,
} from './image-gen';
import { resetGeminiKeyState } from './gemini-keys';

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      update: () => query,
      then: (resolve: (value: { data: never[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
    };
    return { from: () => query };
  },
}));

function imageResponse() {
  return {
    ok: true,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  };
}

function geminiImageResponse() {
  return {
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { mimeType: 'image/png', data: 'QUJD' } }],
          },
        },
      ],
    }),
  };
}

afterEach(() => {
  resetGeminiKeyState();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('generateWithStability', () => {
  it('uses the /sd3 endpoint with a model field for sd3.5 variants', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateWithStability(
      'a villa',
      '1:1',
      'key',
      'sd3.5-large'
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v2beta/stable-image/generate/sd3');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('sd3.5-large');
    expect(form.get('aspect_ratio')).toBe('1:1');
    expect(init.headers.Authorization).toBe('Bearer key');
    expect(out).toMatch(/^data:image\/png;base64,/);
  });

  it('uses the /ultra endpoint with no model field for ultra', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal('fetch', fetchMock);

    await generateWithStability('a villa', '1:1', 'key', 'ultra');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v2beta/stable-image/generate/ultra');
    expect((init.body as FormData).get('model')).toBeNull();
  });

  it('maps aspect ratios Stability does not support to the closest allowed value', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal('fetch', fetchMock);

    await generateWithStability('x', '4:3', 'key', 'sd3.5-large');
    expect(
      (fetchMock.mock.calls[0][1].body as FormData).get('aspect_ratio')
    ).toBe('3:2');

    await generateWithStability('x', '3:4', 'key', 'sd3.5-large');
    expect(
      (fetchMock.mock.calls[1][1].body as FormData).get('aspect_ratio')
    ).toBe('2:3');
  });

  it('surfaces the Stability error message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        text: async () => JSON.stringify({ errors: ['invalid prompt'] }),
      })
    );
    await expect(
      generateWithStability('x', '1:1', 'key', 'ultra')
    ).rejects.toThrow('invalid prompt');
  });
});

describe('generateAiImage — stability provider', () => {
  it('passes a caller timeout to provider fetches', async () => {
    vi.stubEnv('STABILITY_API_KEY', 'st-key');
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal('fetch', fetchMock);

    await generateAiImage({
      prompt: 'x',
      provider: 'stability',
      timeoutMs: 12_000,
    });

    expect(timeoutSpy).toHaveBeenCalledWith(12_000);
    expect(fetchMock.mock.calls[0][1].signal).toBe(signal);
  });

  it('falls back to Gemini when Stability fails and a Gemini key exists', async () => {
    vi.stubEnv('STABILITY_API_KEY', 'st-key');
    vi.stubEnv('GEMINI_API_KEY', 'gm-key');

    const fetchMock = vi.fn((url: string) =>
      url.includes('stability.ai')
        ? Promise.resolve({
            ok: false,
            statusText: 'err',
            text: async () => '{}',
          })
        : Promise.resolve(geminiImageResponse())
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateAiImage({ prompt: 'x', provider: 'stability' });
    expect(out).toMatch(/^data:image\/png;base64,/);
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).includes('generativelanguage')
      )
    ).toBe(true);
  });

  it('errors when Stability is chosen but no key is configured', async () => {
    vi.stubEnv('STABILITY_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    await expect(
      generateAiImage({ prompt: 'x', provider: 'stability' })
    ).rejects.toThrow(IMAGE_PROVIDER_UNAVAILABLE);
    await expect(
      generateAiImage({ prompt: 'x', provider: 'stability' })
    ).rejects.not.toThrow(/STABILITY_API_KEY/);
  });
});

describe('generateAiImage — Hugging Face fallback', () => {
  it('gives Gemini a fresh timeout after Hugging Face times out', async () => {
    vi.stubEnv('HF_ACCESS_TOKEN', 'hf-key');
    vi.stubEnv('GEMINI_API_KEY', 'gm-key');

    const expired = new AbortController();
    expired.abort();
    const fallbackSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValueOnce(expired.signal)
      .mockReturnValueOnce(fallbackSignal);
    const fetchMock = vi.fn((url: string) =>
      url.includes('huggingface.co')
        ? Promise.reject(new DOMException('timed out', 'AbortError'))
        : Promise.resolve(geminiImageResponse())
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateAiImage({
      prompt: 'Ganesh Chaturthi greeting card',
      provider: 'huggingface',
      timeoutMs: 12_000,
    });

    expect(out).toMatch(/^data:image\/png;base64,/);
    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(calls[0]?.[1].signal).toBe(expired.signal);
    expect(calls[1]?.[1].signal).toBe(fallbackSignal);
  });
});

describe('generateAiImage — Gemini account failures', () => {
  const prepaymentDepleted = {
    ok: false,
    status: 402,
    statusText: 'Payment Required',
    json: async () => ({
      error: {
        message:
          'Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.',
      },
    }),
  };

  it('never surfaces a provider 402 as the caller running out of credits', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'gm-key');
    vi.stubEnv('GEMINI_FALLBACK_API_KEYS', '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(prepaymentDepleted))
    );

    const err: Error & { status?: number } = await generateAiImage({
      prompt: 'x',
      provider: 'google',
    }).then(
      () => new Error('expected a rejection'),
      (e: Error & { status?: number }) => e
    );

    expect(err.status).toBe(503);
    expect(err.message).toBe(IMAGE_PROVIDER_UNAVAILABLE);
    expect(err.message).not.toMatch(/ai\.studio|prepayment/i);
  });

  it('rotates to a fallback Gemini key when the primary is depleted', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'gm-depleted');
    vi.stubEnv('GEMINI_FALLBACK_API_KEYS', 'gm-spare');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.includes('gm-depleted') ? prepaymentDepleted : geminiImageResponse()
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateAiImage({ prompt: 'x', provider: 'google' });

    expect(out).toMatch(/^data:image\/png;base64,/);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('gm-spare');
  });
});

describe('hasImageProvider', () => {
  it('finds Gemini keys outside GEMINI_API_KEY', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GEMINI_FALLBACK_API_KEYS', 'gm-spare');
    vi.stubEnv('HF_ACCESS_TOKEN', '');
    vi.stubEnv('STABILITY_API_KEY', '');

    await expect(hasImageProvider('google')).resolves.toBe(true);
    await expect(hasImageProvider('huggingface')).resolves.toBe(true);
    await expect(hasImageProvider('stability')).resolves.toBe(false);
  });

  it('reports no provider when nothing is configured', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GEMINI_FALLBACK_API_KEYS', '');
    vi.stubEnv('HF_ACCESS_TOKEN', '');
    vi.stubEnv('STABILITY_API_KEY', '');

    await expect(hasImageProvider('huggingface')).resolves.toBe(false);
  });
});
