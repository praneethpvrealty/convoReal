import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';

type Redirect = {
  source: string;
  destination: string;
  permanent: boolean;
  has?: Array<{ type: string; value?: string }>;
};

async function appHostRule(): Promise<Redirect> {
  const rules = (await nextConfig.redirects!()) as Redirect[];
  const rule = rules.find((r) =>
    r.has?.some((h) => h.type === 'host' && h.value === 'app\\.convoreal\\.com')
  );
  if (!rule) throw new Error('no app host redirect');
  return rule;
}

function redirects(rule: Redirect, path: string): boolean {
  const pattern = rule.source.match(/^\/:path\((.*)\)$/)![1];
  return new RegExp(`^${pattern}$`).test(path.replace(/^\//, ''));
}

describe('app.convoreal.com', () => {
  it('sends pages to www, keeping the path', async () => {
    const rule = await appHostRule();
    expect(rule.destination).toBe('https://www.convoreal.com/:path');
    expect(rule.permanent).toBe(false);
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
    const rule = await appHostRule();
    for (const path of [
      '/api',
      '/api/leads/email-webhook',
      '/api/whatsapp/webhook',
      '/.well-known/assetlinks.json',
      '/.well-known/apple-app-site-association',
    ])
      expect(redirects(rule, path)).toBe(false);
  });

  it('applies whether or not a legacy domain redirect is configured', async () => {
    const before = process.env.REDIRECT_FROM_DOMAIN;
    process.env.REDIRECT_FROM_DOMAIN = 'old-brand.example';
    try {
      const rules = (await nextConfig.redirects!()) as Redirect[];
      expect(rules[0].has?.[0].value).toBe('app\\.convoreal\\.com');
    } finally {
      if (before === undefined) delete process.env.REDIRECT_FROM_DOMAIN;
      else process.env.REDIRECT_FROM_DOMAIN = before;
    }
  });
});
