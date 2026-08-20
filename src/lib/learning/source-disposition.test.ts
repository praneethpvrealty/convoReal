import { describe, expect, it } from 'vitest';
import { dispositionForSource, fieldPolicy } from './fields';
import { prepareFacts } from './record';

function policy(entity: 'contact' | 'property', field: string) {
  const found = fieldPolicy(entity, field);
  if (!found) throw new Error(`no policy for ${entity}.${field}`);
  return found;
}

describe('dispositionForSource', () => {
  it('downgrades a numeric auto field to propose for the daily sweep', () => {
    // The whole point: pref_budget_max is 'auto' for every in-the-moment
    // learner and must not be for a thread read the next morning.
    expect(policy('contact', 'pref_budget_max').disposition).toBe('auto');
    expect(
      dispositionForSource(policy('contact', 'pref_budget_max'), 'daily_sweep')
    ).toBe('propose');
  });

  it('covers every numeric kind, not just currency', () => {
    for (const field of [
      'pref_budget_min',
      'pref_bhk_min',
      'pref_land_area_min_sqft',
      'pref_min_roi',
    ]) {
      expect(
        dispositionForSource(policy('contact', field), 'daily_sweep')
      ).toBe('propose');
    }
  });

  it('leaves the in-the-moment learners exactly as they were', () => {
    for (const source of [
      'agent_reply',
      'lead_message',
      'owner_reply',
      'portal_sync',
    ] as const) {
      expect(
        dispositionForSource(policy('contact', 'pref_budget_max'), source)
      ).toBe('auto');
    }
  });

  it('leaves lists auto even for the sweep', () => {
    // guardedListValue already needs evidence to NAME a removal, so the
    // failure mode is an extra area rather than a lost one.
    expect(
      dispositionForSource(policy('contact', 'pref_areas'), 'daily_sweep')
    ).toBe('auto');
  });

  it('never upgrades a proposed field to auto', () => {
    expect(
      dispositionForSource(
        policy('property', 'seller_final_price'),
        'daily_sweep'
      )
    ).toBe('propose');
    expect(
      dispositionForSource(
        policy('property', 'seller_final_price'),
        'agent_reply'
      )
    ).toBe('propose');
  });
});

describe('prepareFacts honours the source', () => {
  // The two writes that actually reached production on the first run.
  const suleman = { pref_budget_max: null, pref_bhk_min: null };
  const ramanathan = { pref_budget_max: 100_000_000 };

  it('proposes rather than applies a budget read off a shared listing', () => {
    const [fact] = prepareFacts(
      'contact',
      suleman,
      [{ field: 'pref_budget_max', value: 650_000_000 }],
      'Property: 9 BHK Residential House · ₹65 Cr',
      'daily_sweep'
    );
    expect(fact.disposition).toBe('propose');
  });

  it('proposes rather than silently cutting a real budget by 10x', () => {
    const [fact] = prepareFacts(
      'contact',
      ramanathan,
      [{ field: 'pref_budget_max', value: 10_000_000 }],
      'Vijaya bank layout plots | 2400 sq feet | 25k psqft max',
      'daily_sweep'
    );
    expect(fact.disposition).toBe('propose');
    expect(fact.previous).toBe(100_000_000);
  });

  it('still applies the same fact when a lead states it in the moment', () => {
    const [fact] = prepareFacts(
      'contact',
      suleman,
      [{ field: 'pref_budget_max', value: 20_000_000 }],
      'my budget is 2 cr',
      'lead_message'
    );
    expect(fact.disposition).toBe('auto');
  });

  it('defaults to the historical behaviour when no source is passed', () => {
    const [fact] = prepareFacts('contact', suleman, [
      { field: 'pref_budget_max', value: 20_000_000 },
    ]);
    expect(fact.disposition).toBe('auto');
  });
});
