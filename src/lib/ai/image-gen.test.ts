import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateWithStability, generateAiImage } from './image-gen';

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
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'QUJD' } }] } }],
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('generateWithStability', () => {
  it('uses the /sd3 endpoint with a model field for sd3.5 variants', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateWithStability('a villa', '1:1', 'key', 'sd3.5-large');

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
    expect((fetchMock.mock.calls[0][1].body as FormData).get('aspect_ratio')).toBe('3:2');

    await generateWithStability('x', '3:4', 'key', 'sd3.5-large');
    expect((fetchMock.mock.calls[1][1].body as FormData).get('aspect_ratio')).toBe('2:3');
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
    await expect(generateWithStability('x', '1:1', 'key', 'ultra')).rejects.toThrow('invalid prompt');
  });
});

describe('generateAiImage — stability provider', () => {
  it('falls back to Gemini when Stability fails and a Gemini key exists', async () => {
    vi.stubEnv('STABILITY_API_KEY', 'st-key');
    vi.stubEnv('GEMINI_API_KEY', 'gm-key');

    const fetchMock = vi.fn((url: string) =>
      url.includes('stability.ai')
        ? Promise.resolve({ ok: false, statusText: 'err', text: async () => '{}' })
        : Promise.resolve(geminiImageResponse())
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateAiImage({ prompt: 'x', provider: 'stability' });
    expect(out).toMatch(/^data:image\/png;base64,/);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('generativelanguage'))).toBe(true);
  });

  it('errors when Stability is chosen but no key is configured', async () => {
    vi.stubEnv('STABILITY_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    await expect(generateAiImage({ prompt: 'x', provider: 'stability' })).rejects.toThrow(
      /STABILITY_API_KEY/
    );
  });
});
