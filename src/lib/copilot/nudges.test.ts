import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateNudges } from './nudges';
import * as todayQueries from '@/lib/today/queries';
import * as radarQueries from '@/lib/radar/queries';

vi.mock('@/lib/today/queries', () => ({
  loadExpiringSessions: vi.fn(),
  loadHotGoingQuiet: vi.fn(),
}));
vi.mock('@/lib/radar/queries', () => ({
  loadMatchEvents: vi.fn(),
}));

const mockExpiring = vi.mocked(todayQueries.loadExpiringSessions);
const mockQuiet = vi.mocked(todayQueries.loadHotGoingQuiet);
const mockMatches = vi.mocked(radarQueries.loadMatchEvents);

/** Chainable stub covering the head-count query shapes nudges.ts
 *  uses: from().select(head).gte() and from().select(head).eq(). */
function makeDb(counts: {
  showcase_events?: number;
  whatsapp_config?: number;
  properties?: number;
  contacts?: number;
}): SupabaseClient {
  return {
    from(table: string) {
      const result = {
        count: counts[table as keyof typeof counts] ?? 0,
        error: null,
      };
      const chain = {
        select: () => chain,
        gte: () => Promise.resolve(result),
        eq: () => Promise.resolve(result),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

const populated = {
  showcase_events: 0,
  whatsapp_config: 1,
  properties: 5,
  contacts: 10,
};

function expiringItem(hoursFromNow: number) {
  return {
    conversation: {},
    contact: null,
    lastCustomerAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + hoursFromNow * 3_600_000).toISOString(),
  } as todayQueries.ExpiringSessionItem;
}

beforeEach(() => {
  mockExpiring.mockResolvedValue([]);
  mockQuiet.mockResolvedValue([]);
  mockMatches.mockResolvedValue([]);
});

describe('evaluateNudges', () => {
  it('returns setup nudges for a fresh account, in priority order', async () => {
    const nudges = await evaluateNudges(makeDb({}), 'acc-1');
    expect(nudges.map((n) => n.id)).toEqual([
      'setup-whatsapp',
      'setup-property',
      'setup-contact',
    ]);
  });

  it('data nudges outrank setup nudges and cap at 3', async () => {
    mockExpiring.mockResolvedValue([expiringItem(2)]);
    mockQuiet.mockResolvedValue([
      { contact: {}, daysSilent: 3 } as todayQueries.QuietHotLead,
    ]);
    mockMatches.mockResolvedValue([{ id: 'm1' } as never]);
    const nudges = await evaluateNudges(makeDb({}), 'acc-1');
    expect(nudges).toHaveLength(3);
    expect(nudges.map((n) => n.id)).toEqual([
      'sessions-expiring',
      'hot-leads-quiet',
      'radar-matches',
    ]);
  });

  it('only counts sessions expiring within 6 hours', async () => {
    mockExpiring.mockResolvedValue([expiringItem(2), expiringItem(20)]);
    const nudges = await evaluateNudges(makeDb(populated), 'acc-1');
    const nudge = nudges.find((n) => n.id === 'sessions-expiring');
    expect(nudge?.message).toContain('1 customer chat');
  });

  it('pulse nudge respects the 3-view threshold', async () => {
    const below = await evaluateNudges(
      makeDb({ ...populated, showcase_events: 2 }),
      'acc-1',
    );
    expect(below.find((n) => n.id === 'pulse-weekly-views')).toBeUndefined();

    const at = await evaluateNudges(
      makeDb({ ...populated, showcase_events: 3 }),
      'acc-1',
    );
    const nudge = at.find((n) => n.id === 'pulse-weekly-views');
    expect(nudge?.message).toContain('3 views');
    expect(nudge?.cta?.tourId).toBe('check-property-views');
  });

  it('one failing rule never blanks the rest', async () => {
    mockExpiring.mockRejectedValue(new Error('boom'));
    mockQuiet.mockResolvedValue([
      { contact: {}, daysSilent: 3 } as todayQueries.QuietHotLead,
    ]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nudges = await evaluateNudges(makeDb(populated), 'acc-1');
    expect(nudges.map((n) => n.id)).toContain('hot-leads-quiet');
    warn.mockRestore();
  });

  it('returns an empty list for a healthy, fully set-up account', async () => {
    const nudges = await evaluateNudges(makeDb(populated), 'acc-1');
    expect(nudges).toEqual([]);
  });
});
