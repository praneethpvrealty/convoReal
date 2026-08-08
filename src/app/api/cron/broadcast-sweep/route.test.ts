import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the auth gate on the broadcast sweep. The sender itself is not
 * exercised here — it is stubbed, so an unauthorised request is proven
 * to stop before any WhatsApp send can happen.
 */

const sweep = vi.fn();

vi.mock('@/lib/broadcasts/sender', () => ({
  sweepAndSendBroadcasts: () => sweep(),
}));

let GET: (req: Request) => Promise<Response>;
const url = 'http://localhost/api/cron/broadcast-sweep';

beforeEach(async () => {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.CRON_SECRET;
  sweep.mockReset();
  sweep.mockResolvedValue(undefined);
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.CRON_SECRET;
});

describe('broadcast-sweep cron auth', () => {
  it('fails closed (503) when no secret is configured', async () => {
    const res = await GET(new Request(url));
    expect(res.status).toBe(503);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('rejects a request with no secret', async () => {
    process.env.CRON_SECRET = 'top-secret';
    const res = await GET(new Request(url));
    expect(res.status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret without sending anything', async () => {
    process.env.CRON_SECRET = 'top-secret';
    const res = await GET(
      new Request(url, { headers: { 'x-cron-secret': 'guess' } })
    );
    expect(res.status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('runs the sweep for a correct x-cron-secret', async () => {
    process.env.CRON_SECRET = 'top-secret';
    const res = await GET(
      new Request(url, { headers: { 'x-cron-secret': 'top-secret' } })
    );
    expect(res.status).toBe(200);
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('accepts the bearer form Vercel Cron sends', async () => {
    process.env.CRON_SECRET = 'top-secret';
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer top-secret' } })
    );
    expect(res.status).toBe(200);
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('prefers AUTOMATION_CRON_SECRET when both are set', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'automation-secret';
    process.env.CRON_SECRET = 'other-secret';
    const res = await GET(
      new Request(url, { headers: { 'x-cron-secret': 'automation-secret' } })
    );
    expect(res.status).toBe(200);
  });

  it('reports a failing sweep as 500 rather than a silent success', async () => {
    // A sweep that throws must not look like a drained queue.
    process.env.CRON_SECRET = 'top-secret';
    sweep.mockRejectedValue(new Error('meta unreachable'));
    const res = await GET(
      new Request(url, { headers: { 'x-cron-secret': 'top-secret' } })
    );
    expect(res.status).toBe(500);
  });
});

describe('vercel cron registration', () => {
  it('is scheduled, or the sweep never runs', async () => {
    // The whole point of this route is that nothing was draining
    // stalled broadcasts; an unregistered route repeats that bug.
    const { readFileSync } = await import('node:fs');
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const entry = cfg.crons.find(
      (c: { path: string }) => c.path === '/api/cron/broadcast-sweep'
    );
    expect(entry).toBeDefined();
    expect(entry.schedule).toBeTruthy();
  });
});
