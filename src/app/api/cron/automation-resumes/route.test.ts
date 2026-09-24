import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const drain = vi.fn();
const rpc = vi.fn();
const reminders = vi.fn();
const broadcasts = vi.fn();

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: (fn: string) => rpc(fn) }),
}));

vi.mock('@/lib/automations/resume-pending', () => ({
  RESUME_TIME_BUDGET_MS: 240_000,
  drainPendingExecutions: (opts: unknown) => drain(opts),
}));

vi.mock('@/lib/appointments/reminder', () => ({
  checkAndSendAppointmentReminders: () => reminders(),
}));

vi.mock('@/lib/broadcasts/sender', () => ({
  sweepAndSendBroadcasts: () => broadcasts(),
}));

let GET: (req: Request) => Promise<Response>;
const url = 'http://localhost/api/cron/automation-resumes';

beforeEach(async () => {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.CRON_SECRET;
  drain.mockReset();
  drain.mockResolvedValue({ processed: 0, deferred: 0, skipped: 0 });
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  reminders.mockReset();
  broadcasts.mockReset();
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.CRON_SECRET;
});

describe('automations cron', () => {
  it('is also served at the legacy /api/automations/cron path', async () => {
    const legacy = await import('@/app/api/automations/cron/route');
    expect(legacy.GET).toBe(GET);
    expect(legacy.maxDuration).toBe(300);
  });

  it('fails closed (503) when no secret is configured', async () => {
    const res = await GET(new Request(url));
    expect(res.status).toBe(503);
    expect(drain).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a missing or wrong secret without running anything', async () => {
    process.env.CRON_SECRET = 'top-secret';
    expect((await GET(new Request(url))).status).toBe(401);
    expect(
      (
        await GET(
          new Request(url, { headers: { authorization: 'Bearer guess' } })
        )
      ).status
    ).toBe(401);
    expect(drain).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("runs for Vercel Cron's Authorization: Bearer with CRON_SECRET", async () => {
    process.env.CRON_SECRET = 'top-secret';
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer top-secret' } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 0, deferred: 0, skipped: 0 });
    expect(rpc).toHaveBeenCalledWith('reconcile_subscriptions');
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('still runs for an x-cron-secret matching AUTOMATION_CRON_SECRET', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'automation-secret';
    const res = await GET(
      new Request(url, { headers: { 'x-cron-secret': 'automation-secret' } })
    );
    expect(res.status).toBe(200);
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('leaves reminders and broadcasts to their own crons', async () => {
    process.env.CRON_SECRET = 'top-secret';
    await GET(
      new Request(url, { headers: { authorization: 'Bearer top-secret' } })
    );
    expect(reminders).not.toHaveBeenCalled();
    expect(broadcasts).not.toHaveBeenCalled();
  });

  it('drains resumes even when billing reconciliation fails', async () => {
    process.env.CRON_SECRET = 'top-secret';
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer top-secret' } })
    );
    expect(res.status).toBe(200);
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('reports a failed drain as a 500', async () => {
    process.env.CRON_SECRET = 'top-secret';
    drain.mockRejectedValue(new Error('claim failed'));
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer top-secret' } })
    );
    expect(res.status).toBe(500);
  });
});
