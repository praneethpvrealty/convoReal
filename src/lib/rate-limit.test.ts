import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ioredis is mocked for the whole file. The in-memory tests never
// construct a client (no REDIS_URL), so the mock only matters to the
// "Redis-backed" block below — but it must be hoisted, hence here.
const evalMock = vi.hoisted(() => vi.fn());
const ctorMock = vi.hoisted(() => vi.fn());

vi.mock("ioredis", () => ({
  default: class {
    eval = evalMock;
    on = vi.fn();
    constructor(url: string, opts: unknown) {
      ctorMock(url, opts);
    }
  },
}));

import {
  __resetRateLimitForTests,
  checkRateLimit,
  rateLimitResponse,
} from "./rate-limit";

const OPTS = { limit: 3, windowMs: 60_000 };

// vitest.config.ts sets no REDIS_URL, so the default path everywhere
// below is in-memory. Restored after the Redis block.
const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

describe("checkRateLimit — in-memory (no REDIS_URL)", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    __resetRateLimitForTests();
    evalMock.mockReset();
    ctorMock.mockReset();
  });

  it("permits the first request and decrements remaining", async () => {
    const result = await checkRateLimit("user:1", OPTS);
    expect(result).toMatchObject({
      success: true,
      remaining: 2,
      limit: 3,
    });
    expect(result.reset).toBeGreaterThan(Date.now());
  });

  it("permits exactly `limit` requests then rejects the next", async () => {
    expect((await checkRateLimit("user:1", OPTS)).success).toBe(true);
    expect((await checkRateLimit("user:1", OPTS)).success).toBe(true);
    expect((await checkRateLimit("user:1", OPTS)).success).toBe(true);
    const over = await checkRateLimit("user:1", OPTS);
    expect(over.success).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("keeps separate counters per key", async () => {
    await checkRateLimit("user:1", OPTS);
    await checkRateLimit("user:1", OPTS);
    await checkRateLimit("user:1", OPTS);
    // user:1 is at the cap, user:2 should still be unaffected.
    const other = await checkRateLimit("user:2", OPTS);
    expect(other.success).toBe(true);
    expect(other.remaining).toBe(2);
  });

  it("opens a fresh window after `windowMs` elapses", async () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date("2026-05-01T00:00:00Z").getTime();
      vi.setSystemTime(t0);
      __resetRateLimitForTests();

      await checkRateLimit("user:1", OPTS);
      await checkRateLimit("user:1", OPTS);
      await checkRateLimit("user:1", OPTS);
      expect((await checkRateLimit("user:1", OPTS)).success).toBe(false);

      // Jump just past the window.
      vi.setSystemTime(t0 + OPTS.windowMs + 1);
      const refreshed = await checkRateLimit("user:1", OPTS);
      expect(refreshed.success).toBe(true);
      expect(refreshed.remaining).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never constructs a Redis client without REDIS_URL", async () => {
    await checkRateLimit("user:1", OPTS);
    expect(ctorMock).not.toHaveBeenCalled();
    expect(evalMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// The Redis path. These are the assertions that earn the change: a
// counter shared across instances, and a failure mode that degrades
// rather than breaking.
// ============================================================

describe("checkRateLimit — Redis-backed", () => {
  beforeEach(() => {
    process.env.REDIS_URL = "redis://test-host:6379";
    __resetRateLimitForTests();
    evalMock.mockReset();
    ctorMock.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    __resetRateLimitForTests();
  });

  it("counts in Redis and reports remaining from the shared count", async () => {
    evalMock.mockResolvedValue([1, 60_000]);

    const result = await checkRateLimit("user:1", OPTS);

    expect(result).toMatchObject({ success: true, remaining: 2, limit: 3 });
    expect(evalMock).toHaveBeenCalledOnce();
  });

  it("namespaces the key so it cannot collide with the webhook queue", async () => {
    evalMock.mockResolvedValue([1, 60_000]);
    await checkRateLimit("user:1", OPTS);

    const [, numKeys, key, arg] = evalMock.mock.calls[0];
    expect(numKeys).toBe(1);
    expect(key).toBe("rl:user:1");
    expect(arg).toBe(String(OPTS.windowMs));
  });

  it("rejects once the shared count passes the limit", async () => {
    // A different instance already burned the budget; this one sees 4.
    evalMock.mockResolvedValue([4, 12_000]);

    const result = await checkRateLimit("user:1", OPTS);

    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
    // reset is derived from Redis' TTL, not this instance's clock.
    expect(result.reset).toBeGreaterThan(Date.now());
    expect(result.reset).toBeLessThanOrEqual(Date.now() + 12_000);
  });

  it("allows exactly the limit — the count that equals it still passes", async () => {
    evalMock.mockResolvedValue([3, 30_000]);
    const result = await checkRateLimit("user:1", OPTS);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("reuses one client rather than connecting per request", async () => {
    evalMock.mockResolvedValue([1, 60_000]);
    await checkRateLimit("a", OPTS);
    await checkRateLimit("b", OPTS);
    await checkRateLimit("c", OPTS);
    expect(ctorMock).toHaveBeenCalledOnce();
  });

  it("fails fast rather than queueing commands while disconnected", async () => {
    evalMock.mockResolvedValue([1, 60_000]);
    await checkRateLimit("user:1", OPTS);

    const opts = ctorMock.mock.calls[0][1] as Record<string, unknown>;
    // Without these a Redis blip holds the request open instead of
    // falling through to the in-memory counter.
    expect(opts.enableOfflineQueue).toBe(false);
    expect(opts.commandTimeout).toBeGreaterThan(0);
  });

  it("falls back to the in-memory counter when Redis fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    evalMock.mockRejectedValue(new Error("ECONNREFUSED"));

    // Still limits — just per-instance, which is where we were before.
    expect((await checkRateLimit("user:1", OPTS)).success).toBe(true);
    expect((await checkRateLimit("user:1", OPTS)).success).toBe(true);
    expect((await checkRateLimit("user:1", OPTS)).success).toBe(true);
    expect((await checkRateLimit("user:1", OPTS)).success).toBe(false);
  });

  it("logs a Redis outage once, not once per request", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    evalMock.mockRejectedValue(new Error("ECONNREFUSED"));

    for (let i = 0; i < 5; i += 1) await checkRateLimit(`k${i}`, OPTS);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("rateLimitResponse", () => {
  it("returns a 429 with retry / X-RateLimit headers", async () => {
    const reset = Date.now() + 30_000;
    const res = rateLimitResponse({
      success: false,
      remaining: 0,
      reset,
      limit: 60,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rate limit/i);
  });

  it("clamps Retry-After to a minimum of 1 second", () => {
    // Reset already in the past — the ceiling math would otherwise give 0.
    const res = rateLimitResponse({
      success: false,
      remaining: 0,
      reset: Date.now() - 5_000,
      limit: 10,
    });
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });
});

describe("RATE_LIMITS presets", () => {
  it("send and broadcast budgets are independent", async () => {
    __resetRateLimitForTests();
    // Importing here so the presets stay close to their assertions.
    const { RATE_LIMITS } = await import("./rate-limit");
    expect(RATE_LIMITS.send.limit).toBeGreaterThan(RATE_LIMITS.broadcast.limit);
    expect(RATE_LIMITS.send.windowMs).toBe(60_000);
    expect(RATE_LIMITS.broadcast.windowMs).toBe(60_000);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetRateLimitForTests();
});
