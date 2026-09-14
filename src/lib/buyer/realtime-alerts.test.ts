import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Property } from '@/types';
import type { MatchingResult } from '@/lib/matching';
import { resolveQuietPeriod } from '@/lib/notifications/quiet-hours';
import {
  enqueueRealtimeBuyerAlerts,
  realtimeAlertRetryAt,
} from './realtime-alerts';

vi.mock('@/lib/notifications/quiet-hours', () => ({
  resolveQuietPeriod: vi.fn(),
}));

function chain(result: unknown) {
  const current: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'upsert']) {
    current[method] = vi.fn(() => current);
  }
  current.then = (
    resolve: (value: unknown) => unknown,
    reject: (error: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return current;
}

function match(contact: Contact): MatchingResult {
  return {
    contact,
    score: 80,
    details: {
      type: 'match',
      location: 'match',
      budget: 'match',
      bhk: 'match',
      roi: 'unknown',
    },
    matchedFields: { budget: true, area: true, interest: true },
  };
}

describe('enqueueRealtimeBuyerAlerts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queues only consented reachable buyers and uses the quiet-hours due time', async () => {
    const deliverAt = new Date('2026-09-15T02:30:00.000Z');
    vi.mocked(resolveQuietPeriod).mockResolvedValue({
      isQuiet: true,
      deliverAt,
    });
    const shares = chain({ data: [], error: null });
    const deliveries = chain({ data: [{ id: 'delivery-1' }], error: null });
    const from = vi.fn((table: string) =>
      table === 'property_shares' ? shares : deliveries
    );
    const db = { from } as unknown as SupabaseClient;
    const property = {
      id: 'property-1',
      account_id: 'account-1',
      status: 'Available',
      is_published: true,
    } as Property;
    const consented = {
      id: 'contact-1',
      phone: '+919999999999',
      status: 'active',
      requirement_active: true,
      buyer_alerts_consent: 'granted',
    } as Contact;
    const pending = {
      id: 'contact-2',
      phone: '+918888888888',
      status: 'active',
      requirement_active: true,
      buyer_alerts_consent: 'pending',
    } as Contact;

    await expect(
      enqueueRealtimeBuyerAlerts(
        db,
        'account-1',
        property,
        [match(consented), match(pending)],
        new Date('2026-09-14T17:00:00.000Z')
      )
    ).resolves.toBe(1);

    expect(deliveries.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          account_id: 'account-1',
          property_id: 'property-1',
          contact_id: 'contact-1',
          due_at: deliverAt.toISOString(),
        }),
      ],
      expect.objectContaining({ ignoreDuplicates: true })
    );
  });

  it('does not queue a draft listing', async () => {
    const from = vi.fn();
    const db = { from } as unknown as SupabaseClient;
    const property = {
      id: 'property-1',
      status: 'Pending Review',
      is_published: false,
    } as Property;

    await expect(
      enqueueRealtimeBuyerAlerts(db, 'account-1', property, [])
    ).resolves.toBe(0);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('realtimeAlertRetryAt', () => {
  it('backs off repeated WhatsApp delivery attempts', () => {
    const now = new Date('2026-09-14T10:00:00.000Z');
    expect(realtimeAlertRetryAt(now, 2).toISOString()).toBe(
      '2026-09-14T12:00:00.000Z'
    );
  });
});
