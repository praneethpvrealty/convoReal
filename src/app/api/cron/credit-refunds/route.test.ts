import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const retry = vi.fn();

vi.mock('@/lib/credits/refund-burn', () => ({
  retryQueuedRefunds: () => retry(),
}));

let GET: (req: Request) => Promise<Response>;
const url = 'http://localhost/api/cron/credit-refunds';

beforeEach(async () => {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.CRON_SECRET;
  retry.mockReset();
  retry.mockResolvedValue({ resolved: 2, failed: 1 });
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.CRON_SECRET;
});

describe('[INB-027] credit-refunds cron', () => {
  it('fails closed (503) when no secret is configured', async () => {
    const res = await GET(new Request(url));
    expect(res.status).toBe(503);
    expect(retry).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret without refunding anything', async () => {
    process.env.CRON_SECRET = 'top-secret';
    const res = await GET(
      new Request(url, { headers: { 'x-cron-secret': 'guess' } })
    );
    expect(res.status).toBe(401);
    expect(retry).not.toHaveBeenCalled();
  });

  it('retries the queued refunds for Vercel Cron', async () => {
    process.env.CRON_SECRET = 'top-secret';
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer top-secret' } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { resolved: 2, failed: 1 } });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('reports a failed run as a 500', async () => {
    process.env.CRON_SECRET = 'top-secret';
    retry.mockRejectedValue(new Error('db down'));
    const res = await GET(
      new Request(url, { headers: { 'x-cron-secret': 'top-secret' } })
    );
    expect(res.status).toBe(500);
  });

  it('is registered in vercel.json', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const entry = cfg.crons.find(
      (c: { path: string }) => c.path === '/api/cron/credit-refunds'
    );
    expect(entry?.schedule).toBeTruthy();
  });
});
