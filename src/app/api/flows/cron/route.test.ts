import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sweep = vi.fn();

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({}),
}));

vi.mock('@/lib/flows/sweep', () => ({
  sweepStaleFlowRuns: () => sweep(),
}));

let GET: (req: Request) => Promise<Response>;
const url = 'http://localhost/api/flows/cron';

beforeEach(async () => {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.CRON_SECRET;
  sweep.mockReset();
  sweep.mockResolvedValue({ swept: 0, deferred: 0 });
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.CRON_SECRET;
});

describe('flows cron auth', () => {
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

  it('rejects a wrong secret without sweeping', async () => {
    process.env.CRON_SECRET = 'top-secret';
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer guess' } })
    );
    expect(res.status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it("sweeps for Vercel Cron's Authorization: Bearer with CRON_SECRET", async () => {
    process.env.CRON_SECRET = 'top-secret';
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer top-secret' } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: 0, deferred: 0 });
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('still sweeps for an x-cron-secret matching AUTOMATION_CRON_SECRET', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'automation-secret';
    const res = await GET(
      new Request(url, { headers: { 'x-cron-secret': 'automation-secret' } })
    );
    expect(res.status).toBe(200);
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('reports a failed sweep as a 500', async () => {
    process.env.CRON_SECRET = 'top-secret';
    sweep.mockRejectedValue(new Error('scan failed'));
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer top-secret' } })
    );
    expect(res.status).toBe(500);
  });
});
