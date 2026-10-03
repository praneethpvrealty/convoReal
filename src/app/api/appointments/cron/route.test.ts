import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reminders = vi.fn();
const agentEvents = vi.fn();
const dailyDigests = vi.fn();
const overdueNudges = vi.fn();
const todoReminders = vi.fn();
const deferredNotifications = vi.fn();
const buyerAlerts = vi.fn();
const portalExpiry = vi.fn();

vi.mock('@/lib/appointments/reminder', () => ({
  checkAndSendAppointmentReminders: () => reminders(),
}));
vi.mock('@/lib/calendar/agent-reminders', () => ({
  sendAgentEventReminders: () => agentEvents(),
  sendDailyScheduleDigests: () => dailyDigests(),
  sendOverdueNudges: () => overdueNudges(),
}));
vi.mock('@/lib/portals/expiry-reminders', () => ({
  sendPortalExpiryReminders: () => portalExpiry(),
}));
vi.mock('@/lib/calendar/todo-reminders', () => ({
  sendDueTodoReminders: () => todoReminders(),
}));
vi.mock('@/lib/notifications/create', () => ({
  deliverDeferredNotifications: () => deferredNotifications(),
}));
vi.mock('@/lib/buyer/realtime-alerts', () => ({
  deliverRealtimeBuyerAlertsForConnectedAccounts: () => buyerAlerts(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({}),
}));

const fns = {
  reminders,
  agentEvents,
  dailyDigests,
  overdueNudges,
  todoReminders,
  deferredNotifications,
  buyerAlerts,
  portalExpiry,
};

let GET: (req: Request) => Promise<Response>;
const url = 'http://localhost/api/appointments/cron';

beforeEach(async () => {
  process.env.CRON_SECRET = 'top-secret';
  for (const fn of Object.values(fns)) {
    fn.mockReset();
    fn.mockResolvedValue(undefined);
  }
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.AUTOMATION_CRON_SECRET;
});

describe('appointments cron', () => {
  it('starts every reminder pass concurrently instead of one after another', async () => {
    const started: string[] = [];
    const resolvers: (() => void)[] = [];
    for (const [name, fn] of Object.entries(fns)) {
      fn.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            started.push(name);
            resolvers.push(resolve);
          })
      );
    }

    const resPromise = GET(
      new Request(url, { headers: { authorization: 'Bearer top-secret' } })
    );

    // Flush microtasks without resolving any pass. A sequential
    // `await a(); await b(); ...` chain would have started only the
    // first one by now; Promise.all starts them all up front.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(started.sort()).toEqual(Object.keys(fns).sort());

    for (const resolve of resolvers) resolve();
    const res = await resPromise;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it('still 500s when a pass fails', async () => {
    dailyDigests.mockRejectedValue(new Error('boom'));
    const res = await GET(
      new Request(url, { headers: { authorization: 'Bearer top-secret' } })
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom' });
  });

  it('lets every other pass finish before returning, even when one rejects', async () => {
    // A pass that claims a row (appointment_reminder_log, agent_digest_log,
    // …) before sending must be allowed to finish that send even if a
    // sibling pass fails — otherwise Vercel can freeze the invocation with
    // the claim made but nothing actually sent. Promise.all would settle
    // the response as soon as dailyDigests rejects, without waiting for
    // the still-pending slow pass; allSettled must wait for it.
    dailyDigests.mockRejectedValue(new Error('boom'));
    let resolveSlowPass!: () => void;
    todoReminders.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSlowPass = resolve;
        })
    );

    let responseSettled = false;
    const resPromise = GET(
      new Request(url, { headers: { authorization: 'Bearer top-secret' } })
    ).then((res) => {
      responseSettled = true;
      return res;
    });

    // Flush microtasks so dailyDigests' rejection has every chance to
    // propagate through the route before we check.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(responseSettled).toBe(false);

    resolveSlowPass();
    const res = await resPromise;

    expect(responseSettled).toBe(true);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom' });
  });

  it('fails closed (503) when no secret is configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(new Request(url));
    expect(res.status).toBe(503);
    expect(reminders).not.toHaveBeenCalled();
  });

  it('rejects a missing or wrong secret without running anything', async () => {
    expect((await GET(new Request(url))).status).toBe(401);
    expect(
      (
        await GET(
          new Request(url, { headers: { authorization: 'Bearer guess' } })
        )
      ).status
    ).toBe(401);
    expect(reminders).not.toHaveBeenCalled();
  });
});
