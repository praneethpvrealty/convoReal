import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookup(...args),
}));

import {
  UnsafeUrlError,
  assertSafeFetchUrl,
  hostMatchesDomain,
  isInternalAddress,
  parseSafeFetchUrl,
  safeFetch,
} from './safe-fetch-url';

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

beforeEach(() => {
  lookup.mockReset();
  lookup.mockResolvedValue(PUBLIC);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assertSafeFetchUrl', () => {
  it.each([
    ['an RFC 1918 address', 'http://10.0.0.5/admin'],
    ['another RFC 1918 address', 'http://192.168.1.1/'],
    ['the 172.16/12 block', 'https://172.20.10.4/'],
    ['loopback', 'http://127.0.0.1:8080/'],
    ['loopback written as one integer', 'http://2130706433/'],
    ['loopback written in hex', 'http://0x7f.1/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['the metadata address', 'http://169.254.169.254/latest/meta-data/'],
    [
      'the metadata address mapped into IPv6',
      'http://[::ffff:169.254.169.254]/',
    ],
    ['a unique-local IPv6 address', 'http://[fd00:ec2::254]/'],
    ['loopback as an IPv4-compatible IPv6 address', 'http://[::127.0.0.1]/'],
    ['an internal address wrapped in 6to4', 'http://[2002:a00:5::1]/'],
    ['localhost', 'http://localhost:3000/api'],
    ['localhost with a trailing dot', 'http://localhost./api'],
    ['a localhost subdomain', 'http://app.localhost/'],
  ])('refuses %s without resolving or fetching', async (_label, url) => {
    await expect(assertSafeFetchUrl(url)).rejects.toBeInstanceOf(
      UnsafeUrlError
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    ['a file: URL', 'file:///etc/passwd'],
    ['a data: URL', 'data:text/plain,hello'],
    ['an ftp: URL', 'ftp://example.com/file'],
    ['a relative path', '/etc/passwd'],
    ['an empty string', ''],
  ])('refuses %s', async (_label, url) => {
    await expect(assertSafeFetchUrl(url)).rejects.toBeInstanceOf(
      UnsafeUrlError
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a URL with embedded credentials', async () => {
    await expect(
      assertSafeFetchUrl('https://admin:secret@example.com/')
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(
      assertSafeFetchUrl('https://token@example.com/')
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a public-looking name that resolves inside the network', async () => {
    lookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    await expect(
      assertSafeFetchUrl('https://internal.example.com/')
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses a name when any one of its addresses is internal', async () => {
    lookup.mockResolvedValue([...PUBLIC, { address: '::1', family: 6 }]);
    await expect(
      assertSafeFetchUrl('https://mixed.example.com/')
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses a name that does not resolve', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(
      assertSafeFetchUrl('https://nowhere.example.com/')
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('returns the parsed URL for an allowed public host', async () => {
    const url = await assertSafeFetchUrl('https://housing.com/rd?id=1', {
      allow: (u) => hostMatchesDomain(u.hostname, ['housing.com']),
    });
    expect(url.href).toBe('https://housing.com/rd?id=1');
    expect(lookup).toHaveBeenCalledWith('housing.com', { all: true });
  });

  it.each([
    'https://housing.com/',
    'https://housing.com/leads/whatsapp?lead_id=12345',
    'https://8czw49zf.r.ap-southeast-1.awstrack.me/L0/https:%2F%2Fhsng.co%2Fabc%3Fx=1/1/0100019a-b1c2/Zx9_Q-k=407',
    'https://pahal.housing.com/lead/cta/whatsapp?phone=+919000000000&userName=Test+Buyer',
    'https://proj.supabase.co/storage/v1/object/public/property-images/acc-1/template-headers/1759-ab12c.mp4',
    'https://www.convoreal.com/brand/app-icon-1024.png',
    'https://example.com:8443/a;b=c/d@e/f,g/$h/i&j/100%25?q=a%2Fb&r=%3F#frag',
    'http://93.184.216.34/path',
    'https://housing.com/a[b]^c|d/e(f)!g~h*i',
  ])('hands back %s unchanged apart from the fragment', async (raw) => {
    const url = await assertSafeFetchUrl(raw);
    expect(url.href).toBe(raw.split('#')[0]);
  });

  it('requests the same path and query as the parsed URL for every printable ASCII character', async () => {
    for (let code = 0x20; code < 0x7f; code++) {
      const char = String.fromCharCode(code);
      const raw = `https://example.com/a${char}b/c${char}?d${char}e`;
      const expected = new URL(raw);
      const url = await assertSafeFetchUrl(raw);
      expect(url.pathname, `path with ${JSON.stringify(char)}`).toBe(
        expected.pathname
      );
      expect(url.search, `query with ${JSON.stringify(char)}`).toBe(
        expected.search
      );
    }
  });

  it('keeps a crafted path segment from adding structure to the request', async () => {
    const url = await assertSafeFetchUrl('https://example.com/a%2F..%2Fb/c d');
    expect(url.pathname).toBe('/a%2F..%2Fb/c%20d');
    expect(url.hostname).toBe('example.com');
  });

  it('refuses an IPv6 literal even when it is a public address', async () => {
    await expect(
      assertSafeFetchUrl('https://[2606:4700::1111]/')
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses a public host the caller did not allow, before resolving it', async () => {
    await expect(
      assertSafeFetchUrl('https://evil.example.com/', {
        allow: (u) => hostMatchesDomain(u.hostname, ['housing.com']),
      })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses plain http when the caller asks for https only', () => {
    expect(() =>
      parseSafeFetchUrl('http://example.com/', { httpsOnly: true })
    ).toThrow(UnsafeUrlError);
    expect(
      parseSafeFetchUrl('https://example.com/', { httpsOnly: true }).href
    ).toBe('https://example.com/');
  });
});

describe('hostMatchesDomain', () => {
  it('matches the domain and its subdomains only', () => {
    expect(hostMatchesDomain('housing.com', ['housing.com'])).toBe(true);
    expect(hostMatchesDomain('pahal.housing.com', ['housing.com'])).toBe(true);
    expect(hostMatchesDomain('HOUSING.com.', ['housing.com'])).toBe(true);
    expect(hostMatchesDomain('nothousing.com', ['housing.com'])).toBe(false);
    expect(hostMatchesDomain('housing.com.evil.io', ['housing.com'])).toBe(
      false
    );
  });
});

describe('isInternalAddress', () => {
  it('treats a public address as reachable and anything unparseable as internal', () => {
    expect(isInternalAddress('8.8.8.8')).toBe(false);
    expect(isInternalAddress('2606:4700::1111')).toBe(false);
    expect(isInternalAddress('100.64.0.1')).toBe(true);
    expect(isInternalAddress('not-an-address')).toBe(true);
  });
});

describe('safeFetch', () => {
  it('re-checks a redirect and refuses one that leaves the allow-list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(safeFetch('https://example.com/a')).rejects.toBeInstanceOf(
      UnsafeUrlError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/a', {
      redirect: 'manual',
    });
  });

  it('follows a redirect that stays allowed, resolving a relative Location', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 308, headers: { location: '/b' } })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await safeFetch('https://example.com/a');
    expect(await res.text()).toBe('ok');
    expect(fetchMock).toHaveBeenLastCalledWith('https://example.com/b', {
      redirect: 'manual',
    });
  });

  it('gives up on a redirect loop', async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/again' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(safeFetch('https://example.com/a')).rejects.toBeInstanceOf(
      UnsafeUrlError
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
