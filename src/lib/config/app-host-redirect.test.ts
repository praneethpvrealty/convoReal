import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';

type Condition = { type: string; key?: string; value?: string };
type Redirect = {
  source: string;
  destination: string;
  permanent: boolean;
  has?: Condition[];
  missing?: Condition[];
};

const env = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdref.supabase.co';
  delete process.env.REDIRECT_FROM_DOMAIN;
  delete process.env.NEXT_PUBLIC_BASE_DOMAIN;
});

afterEach(() => {
  process.env = { ...env };
});

async function rules(): Promise<Redirect[]> {
  return (await nextConfig.redirects!()) as Redirect[];
}

async function appHostRule(): Promise<Redirect | undefined> {
  return (await rules()).find((r) =>
    r.has?.some((h) => h.type === 'host' && h.value === 'app\\.convoreal\\.com')
  );
}

function redirects(rule: Redirect, path: string): boolean {
  const pattern = rule.source.match(/^\/:path\((.*)\)$/)![1];
  return new RegExp(`^${pattern}$`).test(path.replace(/^\//, ''));
}

describe('app.convoreal.com', () => {
  it('sends pages to www, keeping the path', async () => {
    const rule = (await appHostRule())!;
    expect(rule.destination).toBe('https://www.convoreal.com/:path');
    expect(rule.permanent).toBe(true);
    for (const path of [
      '/',
      '/login',
      '/dashboard',
      '/docs/abc',
      '/reveal/x',
      '/apis',
    ])
      expect(redirects(rule, path)).toBe(true);
  });

  it('leaves API calls and app-link files on the old host', async () => {
    const rule = (await appHostRule())!;
    for (const path of [
      '/api',
      '/api/leads/email-webhook',
      '/api/whatsapp/webhook',
      '/.well-known/assetlinks.json',
      '/.well-known/apple-app-site-association',
    ])
      expect(redirects(rule, path)).toBe(false);
  });

  it('leaves a signed-in or mid-OAuth visitor on the host their session lives on', async () => {
    const rule = (await appHostRule())!;
    expect(rule.missing).toEqual([
      { type: 'cookie', key: 'sb-abcdref-auth-token' },
      { type: 'cookie', key: 'sb-abcdref-auth-token.0' },
      { type: 'cookie', key: 'sb-abcdref-auth-token-code-verifier' },
    ]);
  });

  it('is never cached, so the cookie check runs on every request', async () => {
    const rule = (await appHostRule())!;
    const headers = (await nextConfig.headers!()) as Array<{
      source: string;
      has?: Condition[];
      missing?: Condition[];
      headers: Array<{ key: string; value: string }>;
    }>;
    const cacheRules = headers.filter((h) =>
      h.headers.some((x) => x.key === 'Cache-Control')
    );
    const appRule = cacheRules.find((h) =>
      h.has?.some(
        (c) => c.type === 'host' && c.value === 'app\\.convoreal\\.com'
      )
    )!;
    expect(appRule.source).toBe(rule.source);
    expect(appRule.missing).toEqual(rule.missing);
    expect(appRule.headers).toEqual([
      { key: 'Cache-Control', value: 'no-store' },
    ]);
    expect(cacheRules.indexOf(appRule)).toBe(cacheRules.length - 1);
  });

  it('is not added when the Supabase project is unknown', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(await appHostRule()).toBeUndefined();
    const headers = (await nextConfig.headers!()) as Array<{
      has?: Condition[];
    }>;
    expect(
      headers.some((h) =>
        h.has?.some(
          (c) => c.type === 'host' && c.value === 'app\\.convoreal\\.com'
        )
      )
    ).toBe(false);
  });

  it('comes before a legacy domain redirect', async () => {
    process.env.REDIRECT_FROM_DOMAIN = 'old-brand.example';
    expect((await rules())[0].has?.[0].value).toBe('app\\.convoreal\\.com');
  });
});
