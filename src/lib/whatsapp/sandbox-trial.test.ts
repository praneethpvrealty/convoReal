import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isSandboxTrialExpired, releaseSandboxSender } from './sandbox-trial';

// A sandbox mapping outlived the trial behind it, so every message from
// one real number was dropped with a bare `continue` for five weeks —
// no reply, no message row, nothing either side could see. These pin
// both halves of the fix: recognising the lapsed trial, and letting go
// of the mapping so the message falls through to a path that answers.

const TRIAL_END = '2026-07-05T17:17:27.634Z';

describe('isSandboxTrialExpired', () => {
  it('is expired after the end date', () => {
    expect(
      isSandboxTrialExpired(
        { trial_ends_at: TRIAL_END },
        new Date('2026-08-13T10:41:00Z')
      )
    ).toBe(true);
  });

  it('is live before the end date', () => {
    expect(
      isSandboxTrialExpired(
        { trial_ends_at: TRIAL_END },
        new Date('2026-07-01T00:00:00Z')
      )
    ).toBe(false);
  });

  it('is live at the boundary itself', () => {
    // Strictly after, matching the comparison the handler used before.
    expect(
      isSandboxTrialExpired({ trial_ends_at: TRIAL_END }, new Date(TRIAL_END))
    ).toBe(false);
  });

  it('treats a config with no end date as open-ended, not expired', () => {
    // A sandbox that was never given a clock must keep routing exactly
    // as it does today — this is the common case for most tenants.
    expect(isSandboxTrialExpired({ trial_ends_at: null })).toBe(false);
    expect(isSandboxTrialExpired({})).toBe(false);
    expect(isSandboxTrialExpired(null)).toBe(false);
    expect(isSandboxTrialExpired(undefined)).toBe(false);
  });

  it('leaves a tenant alone when the date is unparseable', () => {
    // A bad value is a reason not to touch them, not to cut off their
    // prospects.
    expect(isSandboxTrialExpired({ trial_ends_at: 'not-a-date' })).toBe(false);
  });
});

describe('releaseSandboxSender', () => {
  function db(result: { error?: unknown } = {}) {
    const eq = vi.fn(async () => result);
    const del = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ delete: del }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { client: { from } as any, from, del, eq };
  }

  it('deletes exactly the one sender mapping', async () => {
    const d = db();

    expect(await releaseSandboxSender(d.client, '919845475073')).toBe(true);
    expect(d.from).toHaveBeenCalledWith('sandbox_sender_mappings');
    expect(d.eq).toHaveBeenCalledWith('sender_phone', '919845475073');
  });

  it('reports failure without throwing, so the webhook carries on', async () => {
    const d = db({ error: { message: 'nope' } });

    expect(await releaseSandboxSender(d.client, '919845475073')).toBe(false);
  });

  it('survives the client throwing outright', async () => {
    const client = {
      from: () => {
        throw new Error('connection lost');
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    expect(await releaseSandboxSender(client, '919845475073')).toBe(false);
  });
});

// The fix is only worth anything if the handler actually routes through
// it. webhook-handler is 3,800 lines behind a dozen live integrations
// and cannot be imported under a unit runner, so the wiring is pinned
// as source — the same approach control-reply-order.test.ts takes.
describe('the webhook no longer blackholes an expired trial', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/lib/whatsapp/webhook-handler.ts'),
    'utf8'
  );

  it('resolves both sandbox call sites through the live-route helper', () => {
    expect(source).toContain('async function resolveLiveSandboxRoute(');
    // Two call sites: the shared-number path and the no-official-config
    // path. resolveSandboxAccount itself is now only reached through it.
    const calls = source.match(
      /resolveLiveSandboxRoute\(message, senderPhone\)/g
    );
    expect(calls).toHaveLength(2);
    const raw = source.match(/resolveSandboxAccount\(message, senderPhone\)/g);
    expect(raw).toHaveLength(1);
  });

  it('releases the mapping instead of dropping the message', () => {
    expect(source).toContain(
      'releaseSandboxSender(supabaseAdmin(), senderPhone)'
    );
    // The exact bare-drop that swallowed five weeks of messages.
    expect(source).not.toContain(
      'Sandbox trial expired for account ${route.accountId}. Dropping message.'
    );
  });

  it('still enforces the message limit, which is a separate policy', () => {
    // Releasing on expiry must not have taken the per-tenant cap with
    // it — a live tenant over their limit is still capped.
    expect(source).toContain('increment_sandbox_message_count');
    expect(source).toContain('Sandbox message limit reached');
  });
});
