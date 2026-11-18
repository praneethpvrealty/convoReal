import { describe, expect, it } from 'vitest';

import { briefAreas, briefBudget, briefPrefPatch } from './brief-edit';

describe('[CTM-019] contact brief edit', () => {
  const opened = {
    areas_of_interest: ['Bannerghatta Road', 'JP Nagar 6th Phase'],
    pref_areas: ['HSR Layout', 'jp nagar 6th phase'],
    min_budget: '50000000',
    max_budget: '70000000',
    pref_budget_min: null,
    pref_budget_max: null,
  };

  it('opens with every area the matcher reads, agent-entered first', () => {
    expect(briefAreas(opened)).toEqual([
      'Bannerghatta Road',
      'JP Nagar 6th Phase',
      'HSR Layout',
    ]);
  });

  it('opens with the stored budget when only the explicit columns hold it', () => {
    expect(briefBudget(opened)).toEqual({ min: 50000000, max: 70000000 });
  });

  it('prefers the agent-entered budget over the extracted one, as matching does', () => {
    expect(
      briefBudget({
        min_budget: 50000000,
        max_budget: null,
        pref_budget_min: 30000000,
        pref_budget_max: 80000000,
      })
    ).toEqual({ min: 50000000, max: 80000000 });
  });

  it('drops a removed area from the extracted list so it does not come back', () => {
    expect(
      briefPrefPatch(opened, {
        areas: ['JP Nagar 6th Phase'],
        minBudget: 50000000,
        maxBudget: 70000000,
        noBudget: false,
      })
    ).toEqual({ pref_areas: ['jp nagar 6th phase'] });
  });

  it('leaves the extracted columns alone when nothing they hold was changed', () => {
    expect(
      briefPrefPatch(
        { ...opened, pref_budget_max: 70000000 },
        {
          areas: briefAreas(opened),
          minBudget: 50000000,
          maxBudget: 70000000,
          noBudget: false,
        }
      )
    ).toEqual({});
  });

  it('clears an extracted budget bound the agent changed or cleared', () => {
    expect(
      briefPrefPatch(
        {
          pref_areas: [],
          pref_budget_min: 20000000,
          pref_budget_max: 40000000,
        },
        { areas: [], minBudget: null, maxBudget: 60000000, noBudget: false }
      )
    ).toEqual({ pref_budget_min: null, pref_budget_max: null });
  });

  it('keeps an area extracted after the form opened', () => {
    expect(
      briefPrefPatch(
        opened,
        {
          areas: ['JP Nagar 6th Phase'],
          minBudget: 50000000,
          maxBudget: 70000000,
          noBudget: false,
        },
        { pref_areas: ['HSR Layout', 'Whitefield'] }
      )
    ).toEqual({ pref_areas: ['Whitefield'] });
  });

  it('keeps the extracted budget when the agent ticks no budget', () => {
    expect(
      briefPrefPatch(
        { pref_budget_min: 20000000, pref_budget_max: 40000000 },
        { areas: [], minBudget: null, maxBudget: null, noBudget: true }
      )
    ).toEqual({});
  });

  it('treats a budget only rounded for display as unchanged', () => {
    expect(
      briefPrefPatch(
        { pref_budget_min: 12345678 },
        { areas: [], minBudget: 12346000, maxBudget: null, noBudget: false }
      )
    ).toEqual({});
  });
});
