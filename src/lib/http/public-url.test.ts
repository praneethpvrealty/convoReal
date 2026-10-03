import { describe, expect, it, vi } from 'vitest';

import {
  assertPublicUrl,
  fetchPublicUrl,
  isPrivateAddress,
  parsePublicHttpUrl,
  readPublicBody,
} from './public-url';

const publicResolver = async () => ['203.0.113.10'];

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
  ])('treats %s as private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '203.0.113.10', '172.32.0.1', '2606:4700::1111'])(
    'treats %s as public',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  );

  it('treats anything that is not an address as private', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('parsePublicHttpUrl', () => {
  it.each([
    'ftp://example.com/x',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'not a url',
    'https://user:pass@example.com/',
    'https://example.com:8443/',
    'http://localhost/',
    'http://db.internal/',
    'http://printer.local/',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://10.0.0.1/',
  ])('refuses %s', (raw) => {
    expect(() => parsePublicHttpUrl(raw)).toThrow();
  });

  it('accepts public http and https links', () => {
    expect(parsePublicHttpUrl('https://housing.com/rd?id=1').href).toBe(
      'https://housing.com/rd?id=1'
    );
    expect(parsePublicHttpUrl('http://example.com:80/x').hostname).toBe(
      'example.com'
    );
  });

  it('refuses http when only https is allowed', () => {
    expect(() =>
      parsePublicHttpUrl('http://example.com/', { httpsOnly: true })
    ).toThrow(/https/);
  });
});

describe('assertPublicUrl', () => {
  it('refuses a public-looking hostname that resolves to a private address', async () => {
    await expect(
      assertPublicUrl('https://evil.example/', {
        resolve: async () => ['203.0.113.10', '10.0.0.5'],
      })
    ).rejects.toThrow(/private/);
  });

  it('refuses a hostname that does not resolve', async () => {
    await expect(
      assertPublicUrl('https://nowhere.example/', {
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
      })
    ).rejects.toThrow(/resolved/);
    await expect(
      assertPublicUrl('https://nowhere.example/', { resolve: async () => [] })
    ).rejects.toThrow(/private/);
  });

  it('accepts a hostname that resolves to public addresses only', async () => {
    const url = await assertPublicUrl('https://housing.com/rd', {
      resolve: publicResolver,
    });
    expect(url.hostname).toBe('housing.com');
  });

  it('skips resolution for a public IP literal', async () => {
    const resolve = vi.fn();
    await assertPublicUrl('http://203.0.113.10/', { resolve });
    expect(resolve).not.toHaveBeenCalled();
  });
});

function response(body: BodyInit | null, init: ResponseInit = {}) {
  return new Response(body, init);
}

describe('fetchPublicUrl', () => {
  it('re-validates every redirect hop and refuses one into the network', async () => {
    const fetcher = vi.fn(async () =>
      response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      })
    );
    await expect(
      fetchPublicUrl('https://housing.com/rd?id=1', {
        fetcher,
        resolve: publicResolver,
      })
    ).rejects.toThrow(/private/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('follows a public redirect and reports the final url', async () => {
    const seen: string[] = [];
    const fetcher = async (url: string) => {
      seen.push(url);
      return seen.length === 1
        ? response(null, { status: 301, headers: { location: '/landing' } })
        : response('ok');
    };
    const { url, response: res } = await fetchPublicUrl(
      'https://housing.com/rd',
      { fetcher, resolve: publicResolver }
    );
    expect(url).toBe('https://housing.com/landing');
    expect(await res.text()).toBe('ok');
  });

  it('returns a redirect without a location as is', async () => {
    const fetcher = async () => response(null, { status: 302 });
    const { response: res } = await fetchPublicUrl('https://housing.com/rd', {
      fetcher,
      resolve: publicResolver,
    });
    expect(res.status).toBe(302);
  });

  it('gives up after the redirect limit', async () => {
    const fetcher = async (url: string) =>
      response(null, {
        status: 302,
        headers: { location: `${url}/again` },
      });
    await expect(
      fetchPublicUrl('https://housing.com/rd', {
        fetcher,
        resolve: publicResolver,
        maxRedirects: 2,
      })
    ).rejects.toThrow(/too many/);
  });

  it('never follows redirects automatically', async () => {
    const fetcher = vi.fn(async () => response('ok'));
    await fetchPublicUrl('https://housing.com/rd', {
      fetcher,
      resolve: publicResolver,
    });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init).toMatchObject({ redirect: 'manual' });
  });
});

describe('readPublicBody', () => {
  it('refuses a body over the cap, declared or streamed', async () => {
    await expect(
      readPublicBody(
        response('x', { headers: { 'content-length': '999' } }),
        10
      )
    ).rejects.toThrow(/over/);
    await expect(readPublicBody(response('x'.repeat(20)), 10)).rejects.toThrow(
      /over/
    );
  });

  it('returns the bytes of a body under the cap', async () => {
    const bytes = await readPublicBody(response('hello'), 10);
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });
});
