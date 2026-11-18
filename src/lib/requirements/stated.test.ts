import { describe, expect, it } from 'vitest';

import { resolveRequirementSource } from './profiles';
import { hasRequirementText } from './stated';

type Source = Parameters<typeof resolveRequirementSource>[0];

const stated = (contact: Record<string, unknown>) =>
  hasRequirementText(resolveRequirementSource(contact as unknown as Source));

describe('[REQ-009] stated requirements', () => {
  it('counts a demands statement or an active profile, in words', () => {
    expect(stated({ requirements: '1851 sq.ft. flat, east facing' })).toBe(
      true
    );
    expect(
      stated({
        requirement_profiles: [
          { id: 'p', raw_text: 'Vacant plot in Jade Gardens', active: true },
        ],
      })
    ).toBe(true);
  });

  it('leaves out extracted preferences, budgets and blank text', () => {
    expect(stated({ requirements: '   ', pref_areas: ['Banashankari'] })).toBe(
      false
    );
    expect(stated({ pref_budget_max: 56000000 })).toBe(false);
    expect(
      stated({
        requirement_profiles: [
          { id: 'p', raw_text: 'Parked brief', active: false },
        ],
      })
    ).toBe(false);
    expect(hasRequirementText({ requirements: null })).toBe(false);
  });
});
