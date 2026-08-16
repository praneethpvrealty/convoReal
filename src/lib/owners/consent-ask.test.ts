import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  shouldAskOwnerConsent,
  claimOwnerConsentAsk,
  type OwnerConsentFields,
} from './consent-ask';
import type { OwnedListing } from './owner-reply';

function owner(
  overrides: Partial<OwnerConsentFields> = {}
): OwnerConsentFields {
  return {
    id: 'c1',
    name: 'Suresh Rao',
    owner_digest_consent: 'pending',
    owner_digest_consent_requested_at: null,
    ...overrides,
  };
}

function listings(count = 1): OwnedListing[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    title: `Plot ${i + 1}`,
    property_code: null,
    type: null,
    status: null,
    location: null,
    sublocality: null,
    city: null,
    is_published: true,
  }));
}

function db(args: {
  slotTaken?: boolean;
  claimed?: { id: string }[];
}): SupabaseClient {
  return {
    from() {
      return {
        insert: () =>
          Promise.resolve({
            error: args.slotTaken ? { code: '23505' } : null,
          }),
        update: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                select: () =>
                  Promise.resolve({
                    data: args.claimed ?? [{ id: 'c1' }],
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

describe('shouldAskOwnerConsent', () => {
  it('asks a pending owner with listings', () => {
    expect(shouldAskOwnerConsent(owner(), listings())).toBe(true);
  });

  it('never asks twice', () => {
    expect(
      shouldAskOwnerConsent(
        owner({ owner_digest_consent_requested_at: '2026-08-07T10:00:00Z' }),
        listings()
      )
    ).toBe(false);
  });

  it('never asks someone who already answered', () => {
    expect(
      shouldAskOwnerConsent(
        owner({ owner_digest_consent: 'granted' }),
        listings()
      )
    ).toBe(false);
    expect(
      shouldAskOwnerConsent(
        owner({ owner_digest_consent: 'declined' }),
        listings()
      )
    ).toBe(false);
  });

  it('does not ask an owner with nothing to report on', () => {
    expect(shouldAskOwnerConsent(owner(), [])).toBe(false);
  });
});

describe('claimOwnerConsentAsk', () => {
  it('claims the ask and returns the question', async () => {
    const text = await claimOwnerConsentAsk(db({}), 'a1', owner(), listings());
    expect(text).toContain('Suresh');
    expect(text).toContain('Plot 1');
    expect(text).toMatch(/STOP UPDATES/);
  });

  it('stays quiet when the cron already claimed today for this owner', async () => {
    expect(
      await claimOwnerConsentAsk(
        db({ slotTaken: true }),
        'a1',
        owner(),
        listings()
      )
    ).toBeNull();
  });

  it('stays quiet when a racing tick stamped the contact first', async () => {
    expect(
      await claimOwnerConsentAsk(db({ claimed: [] }), 'a1', owner(), listings())
    ).toBeNull();
  });
});
