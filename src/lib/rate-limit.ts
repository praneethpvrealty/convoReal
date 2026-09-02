/**
 * Per-key rate limiter. Redis-backed when REDIS_URL is set, in-memory
 * otherwise.
 *
 * Fixed-window counter (not token bucket): every identifier gets a
 * fresh N-request budget each window.
 *
 * WHY REDIS. The in-memory counter holds its Map in one Node process,
 * so horizontal scale silently defeats it — and on Vercel that is the
 * normal case, not an edge case. Every serverless instance keeps its
 * own Map, so a documented "120 requests a minute" was really "120 per
 * instance", with no ceiling on the total. That is fine for a
 * single-instance VPS, which is how a self-hoster deploys, and wrong
 * for the hosted product.
 *
 * WHICH ONE RUNS. `REDIS_URL` decides:
 *   - set     → Redis. One counter shared by every instance.
 *   - not set → in-memory, byte-for-byte the old behaviour. Local dev
 *               and the test suite need no Redis and no network.
 *
 * WHEN REDIS FAILS. Falls back to the in-memory counter rather than
 * failing open or failing closed. Failing open removes the limit
 * exactly when something is already wrong; failing closed 429s every
 * rate-limited endpoint in the product because a cache is down. The
 * fallback degrades to the behaviour we had yesterday, which is a
 * weaker limit but a working application.
 *
 * ATOMICITY. INCR and the expiry are one Lua script, so two instances
 * racing on the first request of a window cannot both set the TTL and
 * lose a count.
 *
 * COST. One Redis round trip per rate-limited request. Upstash bills
 * per command; see docs/external-services-audit.md for the free-tier
 * command budget before enabling this on a high-traffic endpoint.
 *
 * Memory (in-memory path): entries are ~50 bytes each. With
 * LIGHT_SWEEP below, expired keys get cleared opportunistically on
 * every ~1 000th call, so a healthy instance stays in the low-MB range
 * even with thousands of distinct users. No background timer — works
 * in serverless runtimes that don't keep timers alive across requests.
 */

import { NextResponse } from 'next/server';
import Redis from 'ioredis';

export interface RateLimitOptions {
  /** Max requests allowed in `windowMs`. */
  limit: number;
  /** Window size, milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  /** Requests still allowed in the current window. */
  remaining: number;
  /** Unix ms when the bucket refills. */
  reset: number;
  limit: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

// Opportunistic cleanup. Running a sweep on every call would be
// quadratic; running it 1-in-N lets the Map self-drain without a
// background timer.
const LIGHT_SWEEP_EVERY = 1000;
let callsSinceSweep = 0;

function sweepExpired(now: number) {
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

/** Namespaced so a rate-limit key cannot collide with the WhatsApp
 *  webhook queue sharing the same Redis. */
const REDIS_PREFIX = 'rl:';

/**
 * INCR the counter and, only on the first request of a window, set the
 * expiry. One script so the two cannot interleave across instances.
 * Returns [count, milliseconds until reset].
 *
 * The PTTL guard covers a key that somehow exists without a TTL — it
 * would otherwise count forever and lock the identifier out
 * permanently.
 */
const INCR_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if current == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

let _redis: Redis | null = null;
let _redisUnavailableLoggedAt = 0;

function redisClient(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL, {
      // A rate limiter wants a fast answer or none. Retrying inside
      // the client just holds the request open while the fallback
      // sits there ready.
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
      // Without this, commands issued while disconnected queue up
      // silently and resolve minutes later — the request hangs instead
      // of falling back.
      enableOfflineQueue: false,
    });
    // ioredis emits 'error' on every reconnection attempt. Unhandled,
    // it takes the process down; the check path already reports the
    // failure it cares about, so this only has to stop the crash.
    _redis.on('error', () => {});
  }
  return _redis;
}

/** Logged at most once a minute — a Redis outage would otherwise write
 *  one line per request, which buries the incident it is reporting. */
function noteRedisUnavailable(err: unknown): void {
  const now = Date.now();
  if (now - _redisUnavailableLoggedAt < 60_000) return;
  _redisUnavailableLoggedAt = now;
  console.error(
    '[rate-limit] Redis unavailable, falling back to the in-process counter. ' +
      'Limits are per-instance until it recovers.',
    err
  );
}

function checkInMemory(
  key: string,
  { limit, windowMs }: RateLimitOptions
): RateLimitResult {
  const now = Date.now();

  callsSinceSweep += 1;
  if (callsSinceSweep >= LIGHT_SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweepExpired(now);
  }

  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      success: true,
      remaining: limit - 1,
      reset: now + windowMs,
      limit,
    };
  }

  if (entry.count >= limit) {
    return { success: false, remaining: 0, reset: entry.resetAt, limit };
  }

  entry.count += 1;
  return {
    success: true,
    remaining: limit - entry.count,
    reset: entry.resetAt,
    limit,
  };
}

/**
 * Consume one request against `key`.
 *
 * Async because the Redis path is a network call. Every call site is
 * already inside an async route handler, and TypeScript rejects a
 * missing `await` — `RateLimitResult` and `Promise<RateLimitResult>`
 * are not interchangeable at either `.success` or `rateLimitResponse`.
 */
export async function checkRateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const client = redisClient();
  if (!client) return checkInMemory(key, options);

  const { limit, windowMs } = options;

  try {
    const [count, ttl] = (await client.eval(
      INCR_SCRIPT,
      1,
      `${REDIS_PREFIX}${key}`,
      String(windowMs)
    )) as [number, number];

    const reset = Date.now() + Math.max(ttl, 0);

    if (count > limit) {
      return { success: false, remaining: 0, reset, limit };
    }
    return { success: true, remaining: Math.max(limit - count, 0), reset, limit };
  } catch (err) {
    noteRedisUnavailable(err);
    return checkInMemory(key, options);
  }
}

/**
 * Standard 429 response with the headers clients expect (RFC 6585 +
 * draft-ietf-httpapi-ratelimit-headers). Callers just `return` this.
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfterSec = Math.max(
    1,
    Math.ceil((result.reset - Date.now()) / 1000)
  );
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      retry_after_seconds: retryAfterSec,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
      },
    }
  );
}

/** Preconfigured budgets, tweak here not at call sites. */
export const RATE_LIMITS = {
  /** Individual message send. 60/min per user = one per second
   *  sustained, comfortable for a live human typing. */
  send: { limit: 60, windowMs: 60_000 },
  /** Broadcast dispatch. 5/min per user — even a 1 000-recipient
   *  broadcast is one call; this caps the rate at which a single user
   *  can launch campaigns, not the messages inside one. */
  broadcast: { limit: 5, windowMs: 60_000 },
  /** Reaction add/swap/remove. More permissive than send — users
   *  fidget with reactions and a single "swap" is actually two calls
   *  (remove + add) under the hood. */
  react: { limit: 120, windowMs: 60_000 },
  /** Invitation peek (public, per-IP). 30/min lets a forwarded link
   *  retry a handful of times under flaky connectivity without
   *  enabling brute-force token enumeration. With 256-bit tokens the
   *  enumeration risk is theoretical; this is belt-and-braces. */
  invitationPeek: { limit: 30, windowMs: 60_000 },
  /** Invitation redeem (authed, per-IP+user). Tighter than peek —
   *  successful redemption mutates two profiles and an invite row, so
   *  the abuse surface is "spam join attempts." */
  invitationRedeem: { limit: 10, windowMs: 60_000 },
  /** Admin-only account / member-management actions: create/revoke
   *  invitation, rename account, change member role, remove member,
   *  transfer ownership. 30/min per user is comfortably above any
   *  realistic legitimate use (the Members tab is a clicks-only UI)
   *  while still bounding accidental abuse from a script run in a
   *  loop or a compromised admin session spamming role flips. */
  adminAction: { limit: 30, windowMs: 60_000 },
  /** Copilot helper chat, per user. Free feature — the operator pays
   *  for Gemini, so cap bursts hard while leaving a human typing
   *  questions comfortable. */
  copilotChat: { limit: 10, windowMs: 60_000 },
  /** Copilot helper chat, per account per day. Backstop that bounds a
   *  single tenant's worst-case Gemini spend. Fixed window resets on
   *  deploy — fine for a cost cap, not a billing meter. */
  copilotChatDaily: { limit: 150, windowMs: 86_400_000 },
  /** Entity autocomplete in the Copilot composer. Debounced clients
   *  normally use a handful of reads per search; this ceiling bounds
   *  scripted contact/inventory enumeration without slowing typing. */
  copilotEntitySearch: { limit: 120, windowMs: 60_000 },
  /** Confirmed Copilot writes. Each request is also idempotent in the
   *  database; this bounds fresh action IDs from a stuck or scripted client. */
  copilotAction: { limit: 12, windowMs: 60_000 },
  /** Portfolio helper chat, per portal user per day. Owners and
   *  buyers have no account to bound, so the daily backstop is
   *  per-person and tighter than a whole agency's: a portal user with
   *  four screens has far less to ask about than an agent running a
   *  brokerage. Burst reuses copilotChat. */
  copilotPortalDaily: { limit: 40, windowMs: 86_400_000 },
  /** Copilot nudge evaluation — cheap RLS-scoped reads, but bounded
   *  anyway since one call fans out to several queries. */
  copilotNudges: { limit: 6, windowMs: 60_000 },
  /** Copilot answer 👍/👎 — one write per tap, same posture as react. */
  copilotFeedback: { limit: 30, windowMs: 60_000 },
  /** Help-desk ticket filing from the helper. A human stuck on a task
   *  files one, maybe two — a burst is either a stuck client or spam,
   *  and every ticket lands in the operator's queue. */
  supportTicket: { limit: 5, windowMs: 3_600_000 },
  /** AI suggested-replies, per user. On-demand (agent taps a button), so
   *  bursts are naturally small; 20/min is comfortable for a human
   *  working an inbox while bounding a stuck client that re-requests. */
  suggestReplies: { limit: 20, windowMs: 60_000 },
  /** AI suggested-replies, per account per day. Backstop that bounds a
   *  single tenant's worst-case Gemini spend on this feature, mirroring
   *  copilotChatDaily. Fixed window resets on deploy — fine for a cost
   *  cap, not a billing meter. */
  suggestRepliesDaily: { limit: 400, windowMs: 86_400_000 },
  /** Server-side flyer rendering (next/og). CPU-bound satori work per
   *  call; 60/min per user keeps a debounced preview slider responsive
   *  while bounding a stuck client re-rendering in a loop. */
  flyerRender: { limit: 60, windowMs: 60_000 },
  /** Admin plan-override OTP issue + verify. Tighter than adminAction —
   *  this gates a billing-bypassing action, so both the code-send and
   *  code-check endpoints share one strict budget per admin to blunt
   *  brute-force guessing of a 6-digit code (5 attempts/challenge is
   *  the primary defense; this bounds how many challenges/guesses an
   *  admin session can burn through per minute on top of that). */
  adminOtp: { limit: 8, windowMs: 60_000 },
  /** Public catalog read (`GET /api/public/properties`), per IP. The
   *  endpoint pages a tenant's published inventory at up to MAX_LIMIT
   *  (50) rows a call, so the budget is really "how fast can one
   *  client drain a catalog". A full sync of a 500-listing brokerage
   *  is 10 calls; 30/min leaves room for three of those a minute and
   *  still caps a naive scraper at 1 500 rows/min. Applied before the
   *  API-key check so key guessing is bounded too. */
  publicCatalog: { limit: 30, windowMs: 60_000 },
  /** Same endpoint, per `account_id`. The per-IP budget above does
   *  nothing against a distributed scrape of ONE brokerage, which is
   *  the case that actually costs a tenant. Deliberately well above
   *  the per-IP number: this is a ceiling on total interest in a
   *  single account, and setting it near the per-IP budget would let
   *  one abuser lock out that tenant's legitimate integrations. */
  publicCatalogAccount: { limit: 120, windowMs: 60_000 },
  /** `/api/v1/*` read+write, per API key. The consumer is an agent or
   *  an automation run, not a human clicking — a burst here is a tool
   *  loop fanning out over an inventory, which is legitimate. 120/min
   *  is roughly two calls a second sustained, comfortable for an MCP
   *  session resolving a multi-step question while still bounding a
   *  runaway loop. Applied before the key is looked up, so guessing is
   *  bounded on the same budget. */
  apiKeyV1: { limit: 120, windowMs: 60_000 },
} as const;

/** Test-only helper. Clears the in-memory state so unit tests don't
 *  leak buckets across files. Not wired up in production code. */
export function __resetRateLimitForTests() {
  buckets.clear();
  callsSinceSweep = 0;
  // Drop the cached client too, so a test can flip REDIS_URL and get
  // the path it asked for instead of one another test warmed up.
  _redis = null;
  _redisUnavailableLoggedAt = 0;
}
