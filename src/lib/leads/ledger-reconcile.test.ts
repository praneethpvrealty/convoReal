// ============================================================
// Guards the reconcile planner's three-way split. The stakes:
// an entry wrongly routed to `reingest` re-runs the webhook and
// re-sends the auto-reply to a real lead's WhatsApp; one wrongly
// routed to `markOnly` is a lost lead declared delivered.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  planLedgerActions,
  reingestOutcome,
  PUSH_GRACE_MS,
  type LedgerEntry,
} from './ledger-reconcile';

const NOW = Date.parse('2026-08-04T06:00:00Z');

function entry(id: string, ageMs: number): LedgerEntry {
  return {
    id,
    accountId: 'acc-1',
    from: '"Housing.com" <noreply@housing-mailer.com>',
    subject: 'Housing - Lead interested in your property',
    receivedAt: new Date(NOW - ageMs).toISOString(),
    status: 'push-failed',
  };
}

describe('planLedgerActions', () => {
  it('never reprocesses an entry the engine already logged', () => {
    const plan = planLedgerActions([entry('a', PUSH_GRACE_MS * 2)], new Set(['a']), NOW);

    expect(plan.markOnly.map((e) => e.id)).toEqual(['a']);
    expect(plan.reingest).toHaveLength(0);
  });

  it('re-ingests an unknown entry past the push grace window', () => {
    const plan = planLedgerActions([entry('b', PUSH_GRACE_MS + 1)], new Set(), NOW);

    expect(plan.reingest.map((e) => e.id)).toEqual(['b']);
  });

  it('defers a fresh entry so an in-flight push is not raced', () => {
    const plan = planLedgerActions([entry('c', PUSH_GRACE_MS - 1)], new Set(), NOW);

    expect(plan.deferred.map((e) => e.id)).toEqual(['c']);
    expect(plan.reingest).toHaveLength(0);
  });

  it('a known entry is marked even when fresh — logged beats deferred', () => {
    const plan = planLedgerActions([entry('d', 0)], new Set(['d']), NOW);

    expect(plan.markOnly.map((e) => e.id)).toEqual(['d']);
    expect(plan.deferred).toHaveLength(0);
  });

  it('an unparseable receivedAt is re-ingested, not deferred forever', () => {
    const bad = { ...entry('e', 0), receivedAt: 'not-a-date' };
    const plan = planLedgerActions([bad], new Set(), NOW);

    expect(plan.reingest.map((e) => e.id)).toEqual(['e']);
  });
});

describe('reingestOutcome', () => {
  it('2xx heals', () => {
    expect(reingestOutcome(200)).toBe('healed');
  });

  it('a conscious engine refusal is final — the entry must stop resurfacing', () => {
    expect(reingestOutcome(403)).toBe('rejected');
    expect(reingestOutcome(422)).toBe('rejected');
  });

  it('5xx and rate-limiting are transient and retried next cycle', () => {
    expect(reingestOutcome(500)).toBe('retry');
    expect(reingestOutcome(429)).toBe('retry');
  });
});
