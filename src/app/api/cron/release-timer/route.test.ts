import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
let GET: (req: Request) => Promise<Response>;
const url = 'http://localhost/api/cron/release-timer';
const authed = { headers: { authorization: 'Bearer top-secret' } };

function configure() {
  process.env.CRON_SECRET = 'top-secret';
  process.env.RELEASE_TIMER_GITHUB_TOKEN = 'gh-token';
  process.env.VERCEL_GIT_REPO_OWNER = 'owner';
  process.env.VERCEL_GIT_REPO_SLUG = 'repo';
}

function clear() {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.CRON_SECRET;
  delete process.env.RELEASE_TIMER_GITHUB_TOKEN;
  delete process.env.VERCEL_GIT_REPO_OWNER;
  delete process.env.VERCEL_GIT_REPO_SLUG;
}

beforeEach(async () => {
  clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  clear();
  vi.unstubAllGlobals();
});

describe('release-timer cron', () => {
  it('fails closed (503) when no cron secret is configured', async () => {
    const res = await GET(new Request(url, authed));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret without dispatching', async () => {
    configure();
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer guess' } })
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed (503) when the GitHub token is missing', async () => {
    configure();
    delete process.env.RELEASE_TIMER_GITHUB_TOKEN;
    const res = await GET(new Request(url, authed));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dispatches the release-timer workflow on main', async () => {
    configure();
    const res = await GET(new Request(url, authed));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { dispatched: true } });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/actions/workflows/release-timer.yml/dispatches',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ref: 'main' }),
        headers: expect.objectContaining({ Authorization: 'Bearer gh-token' }),
      })
    );
  });

  it('reports a refused dispatch as a 502', async () => {
    configure();
    fetchMock.mockResolvedValueOnce(
      new Response('Resource not accessible', { status: 403 })
    );
    const res = await GET(new Request(url, authed));
    expect(res.status).toBe(502);
  });
});
