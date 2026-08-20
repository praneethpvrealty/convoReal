import { describe, expect, it } from 'vitest';
import { sanitizeFindings } from './analyze';
import type { SweepThread } from './types';

const OCCURRED = '2026-08-19T12:00:00.000Z';

function thread(over: Partial<SweepThread> = {}): SweepThread {
  return {
    accountId: 'acc-1',
    channel: 'client',
    contactId: 'contact-1',
    contactName: 'Anju',
    conversationId: 'conv-1',
    assignedAgentId: null,
    propertyId: null,
    messages: [],
    ...over,
  };
}

describe('sanitizeFindings', () => {
  it('returns nothing for a null answer', () => {
    expect(sanitizeFindings(null, thread(), OCCURRED)).toEqual({
      facts: [],
      gaps: [],
    });
  });

  it('keeps a whitelisted contact fact with its evidence', () => {
    const out = sanitizeFindings(
      {
        facts: [
          {
            entity: 'contact',
            field: 'pref_budget_max',
            value: 20000000,
            evidence: 'my budget is 2 cr',
          },
        ],
      },
      thread(),
      OCCURRED
    );
    expect(out.facts).toEqual([
      {
        entity: 'contact',
        field: 'pref_budget_max',
        value: 20000000,
        evidence: 'my budget is 2 cr',
      },
    ]);
  });

  it('drops a field that is not on the whitelist', () => {
    // A model that returns "is_published" or "account_id" is ignored
    // rather than obeyed.
    const out = sanitizeFindings(
      {
        facts: [
          {
            entity: 'contact',
            field: 'account_id',
            value: 'x',
            evidence: 'hi',
          },
          {
            entity: 'contact',
            field: 'is_published',
            value: true,
            evidence: 'hi',
          },
        ],
      },
      thread(),
      OCCURRED
    );
    expect(out.facts).toEqual([]);
  });

  it('drops a property fact when no listing is under discussion', () => {
    // Guessing which of the account's listings it meant is how a sweep
    // reprices the wrong one.
    const out = sanitizeFindings(
      {
        facts: [
          {
            entity: 'property',
            field: 'seller_final_price',
            value: 13000000,
            evidence: 'owner will take 1.3 cr',
          },
        ],
      },
      thread({ propertyId: null }),
      OCCURRED
    );
    expect(out.facts).toEqual([]);
  });

  it('keeps that same property fact when a listing IS under discussion', () => {
    const out = sanitizeFindings(
      {
        facts: [
          {
            entity: 'property',
            field: 'seller_final_price',
            value: 13000000,
            evidence: 'owner will take 1.3 cr',
          },
        ],
      },
      thread({ propertyId: 'prop-1' }),
      OCCURRED
    );
    expect(out.facts).toHaveLength(1);
  });

  it('drops a fact with no evidence behind it', () => {
    const out = sanitizeFindings(
      {
        facts: [
          {
            entity: 'contact',
            field: 'pref_budget_max',
            value: 20000000,
            evidence: '',
          },
        ],
      },
      thread(),
      OCCURRED
    );
    expect(out.facts).toEqual([]);
  });

  it('turns a promise into an unkept_promise gap named after the contact', () => {
    const out = sanitizeFindings(
      {
        promises: [
          {
            summary: 'send the floor plan',
            evidence: "I'll send the floor plan tonight",
            action: 'Send it',
            overdue: true,
          },
        ],
      },
      thread(),
      OCCURRED
    );
    expect(out.gaps).toHaveLength(1);
    expect(out.gaps[0].kind).toBe('unkept_promise');
    expect(out.gaps[0].severity).toBe('high');
    expect(out.gaps[0].summary).toBe('Anju: send the floor plan');
    expect(out.gaps[0].occurredAt).toBe(OCCURRED);
  });

  it('drops a promise with no quote to approve it on', () => {
    const out = sanitizeFindings(
      { promises: [{ summary: 'do something', evidence: '' }] },
      thread(),
      OCCURRED
    );
    expect(out.gaps).toEqual([]);
  });

  it('caps a model that listed everything it could think of', () => {
    const out = sanitizeFindings(
      {
        promises: Array.from({ length: 9 }, (_, i) => ({
          summary: `promise ${i}`,
          evidence: `said ${i}`,
        })),
        facts: Array.from({ length: 20 }, () => ({
          entity: 'contact',
          field: 'pref_budget_max',
          value: 20000000,
          evidence: 'budget 2cr',
        })),
      },
      thread(),
      OCCURRED
    );
    expect(out.gaps.length).toBeLessThanOrEqual(2);
    expect(out.facts.length).toBeLessThanOrEqual(8);
  });
});
