import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

// ── Stateful billing-admin mock ────────────────────────────────────
// A tiny in-memory Supabase stand-in. It is stateful on purpose:
// `insert` records rows and the dedup `select().eq().maybeSingle()`
// looks them up — so a real webhook redelivery (delivery #2 finding the
// row delivery #1 inserted) behaves exactly as it would in production.
type Row = Record<string, unknown>;
let store: { subscriptions: Row[]; subscription_events: Row[] };

function resetStore() {
  store = {
    subscriptions: [
      { account_id: 'acc-1', plan: 'team', razorpay_subscription_id: 'sub_1' },
    ],
    subscription_events: [],
  };
}

function makeAdmin() {
  return {
    from(table: keyof typeof store) {
      let op: 'select' | 'update' | 'insert' | null = null;
      const filters: Row = {};
      const builder: Record<string, unknown> = {
        select() {
          op = 'select';
          return builder;
        },
        update() {
          op = 'update';
          return builder;
        },
        insert(payload: Row | Row[]) {
          const rows = Array.isArray(payload) ? payload : [payload];
          store[table].push(...rows);
          return Promise.resolve({ data: null, error: null });
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          // For updates the chain terminates at `.eq()` and is awaited.
          if (op === 'update') return Promise.resolve({ data: null, error: null });
          return builder;
        },
        maybeSingle() {
          const row = store[table].find((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v)
          );
          return Promise.resolve({ data: row ?? null, error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/billing/admin-client', () => ({
  billingAdmin: () => makeAdmin(),
}));

const grantMock = vi.fn(async () => undefined);
const creditPurchaseMock = vi.fn(async () => ({}));
vi.mock('@/lib/credits/grant', () => ({
  grantSubscriptionCredits: (...args: unknown[]) => grantMock(...(args as [])),
  creditPurchase: (...args: unknown[]) => creditPurchaseMock(...(args as [])),
}));

const referralMock = vi.fn(async () => undefined);
vi.mock('@/lib/credits/referral', () => ({
  processReferralConversion: (...args: unknown[]) => referralMock(...(args as [])),
}));

const { POST } = await import('./route');

const SECRET = 'whsec_test';

function chargedEvent(withId: boolean) {
  return {
    ...(withId ? { id: 'evt_charged_1' } : {}),
    event: 'subscription.charged',
    payload: {
      subscription: {
        entity: {
          id: 'sub_1',
          current_start: 1_700_000_000,
          current_end: 1_702_592_000,
          plan_id: 'plan_team_monthly',
        },
      },
      payment: { entity: { id: 'pay_1', amount: 79900 } },
    },
  };
}

function post(event: unknown, secret = SECRET) {
  const rawBody = JSON.stringify(event);
  const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return POST(
    new Request('http://localhost/api/billing/razorpay-webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': signature },
      body: rawBody,
    }) as never
  );
}

beforeEach(() => {
  resetStore();
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

describe('POST /api/billing/razorpay-webhook — redelivery dedup', () => {
  it('rejects an invalid signature and grants nothing', async () => {
    const res = await post(chargedEvent(true), 'wrong-secret');
    expect(res.status).toBe(401);
    expect(grantMock).not.toHaveBeenCalled();
  });

  it('dedups redelivery when the event carries a top-level id (grants once)', async () => {
    const res1 = await post(chargedEvent(true));
    const res2 = await post(chargedEvent(true));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // Delivery #2 finds the subscription_events row inserted by #1.
    expect(grantMock).toHaveBeenCalledTimes(1);
  });

  it('BUG: an id-less event is re-granted on every redelivery (double-spend)', async () => {
    // Razorpay retries webhooks; the dedup guard is gated on
    // `if (event.id)`, so an event delivered without a top-level id
    // skips dedup entirely and re-grants a full cycle of credits each
    // time. This asserts the current (buggy) behavior — when the guard
    // is fixed to dedup on a stable fallback ref, flip this to
    // toHaveBeenCalledTimes(1).
    await post(chargedEvent(false));
    await post(chargedEvent(false));
    await post(chargedEvent(false));
    expect(grantMock).toHaveBeenCalledTimes(3);
  });
});
