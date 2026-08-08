import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import { shouldAskBuyerConsent, claimBuyerConsentAsk } from './consent-ask';

function buyer(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    account_id: 'a1',
    name: 'Ravi Kumar',
    classification: 'Buyer',
    buyer_alerts_consent: 'pending',
    buyer_alerts_consent_requested_at: null,
    max_budget: 50000000,
    ...overrides,
  } as unknown as Contact;
}

function db(claimed: { id: string }[] | null): SupabaseClient {
  return {
    from() {
      return {
        update() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    is() {
                      return {
                        select: () =>
                          Promise.resolve({ data: claimed, error: null }),
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe('shouldAskBuyerConsent', () => {
  it('asks a pending buyer who has told us what they want', () => {
    expect(shouldAskBuyerConsent(buyer())).toBe(true);
  });

  it('never asks twice', () => {
    expect(
      shouldAskBuyerConsent(
        buyer({ buyer_alerts_consent_requested_at: '2026-08-07T10:00:00Z' }),
      ),
    ).toBe(false);
  });

  it('never asks someone who already answered', () => {
    expect(shouldAskBuyerConsent(buyer({ buyer_alerts_consent: 'granted' }))).toBe(false);
    expect(shouldAskBuyerConsent(buyer({ buyer_alerts_consent: 'declined' }))).toBe(false);
  });

  it('does not ask a buyer with no brief — there is nothing to alert on', () => {
    expect(
      shouldAskBuyerConsent(
        buyer({ max_budget: undefined, min_budget: undefined, requirements: undefined }),
      ),
    ).toBe(false);
  });

  it('does not ask non-buyers', () => {
    expect(shouldAskBuyerConsent(buyer({ classification: 'Owner' }))).toBe(false);
  });
});

describe('claimBuyerConsentAsk', () => {
  it('claims the ask and returns the question', async () => {
    const text = await claimBuyerConsentAsk(db([{ id: 'c1' }]), 'a1', buyer(), 'Acme', 3);
    expect(text).toContain('Ravi');
    expect(text).toMatch(/START ALERTS/);
    expect(text).toMatch(/Acme/);
  });

  it('stays quiet when a racing tick claimed the ask first', async () => {
    // The conditional UPDATE matched zero rows — someone else asked.
    expect(await claimBuyerConsentAsk(db([]), 'a1', buyer(), 'Acme', 3)).toBeNull();
  });

  it('does not touch the row for a contact that must not be asked', async () => {
    expect(
      await claimBuyerConsentAsk(
        db([{ id: 'c1' }]),
        'a1',
        buyer({ buyer_alerts_consent: 'declined' }),
        'Acme',
        3,
      ),
    ).toBeNull();
  });
});
