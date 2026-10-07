import { beforeEach, describe, expect, it, vi } from 'vitest';

const run = vi.fn();
vi.mock('@/lib/whatsapp/inbound/transcripts/thread-review', () => ({
  runBotThreadReview: () => run(),
}));

let GET: (req: Request) => Promise<Response>;
const url = 'http://localhost/api/cron/bot-thread-review';

beforeEach(async () => {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.CRON_SECRET;
  run.mockReset();
  run.mockResolvedValue({ threads: 2, reviewed: 2, skipped: 0, failed: 0 });
  vi.resetModules();
  ({ GET } = await import('./route'));
});

describe('[CNV-006] GET /api/cron/bot-thread-review', () => {
  it('fails closed without a configured secret', async () => {
    const res = await GET(new Request(url));
    expect(res.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a wrong secret', async () => {
    process.env.CRON_SECRET = 'right';
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer wrong' } })
    );
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the review for Vercel Cron and for the header secret', async () => {
    process.env.CRON_SECRET = 'right';
    const bearer = await GET(
      new Request(url, { headers: { authorization: 'Bearer right' } })
    );
    expect(bearer.status).toBe(200);
    expect(await bearer.json()).toEqual({
      threads: 2,
      reviewed: 2,
      skipped: 0,
      failed: 0,
    });
    const header = await GET(
      new Request(url, { headers: { 'x-cron-secret': 'right' } })
    );
    expect(header.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports a run that threw', async () => {
    process.env.CRON_SECRET = 'right';
    run.mockRejectedValue(new Error('db down'));
    const res = await GET(
      new Request(url, { headers: { 'x-cron-secret': 'right' } })
    );
    expect(res.status).toBe(500);
  });
});
