import { describe, expect, it } from 'vitest';

import {
  activeRequirementFilterCount,
  REQUIREMENT_CONTACT_COLUMNS,
  REQUIREMENT_OWNER_CLASSIFICATIONS,
  requirementContactSearchFilter,
  effectiveAreas,
  effectiveCategories,
  effectiveMaxBudget,
  EMPTY_REQUIREMENT_FILTERS,
  filterRequirements,
  matchesPriority,
  requirementBudgetLabel,
  requirementCurrency,
  requirementStats,
  visibleTagSuggestions,
  type RequirementRow,
} from './requirements-feed';

const row = (patch: Partial<RequirementRow>): RequirementRow =>
  ({
    id: 'c1',
    name: 'A',
    classification: 'Buyer',
    ...patch,
  }) as RequirementRow;

describe('requirementStats', () => {
  it('[REQ-004] counts the board the same way the web tiles do', () => {
    const rows = [
      row({ id: '1', lead_temp: 'HOT' }),
      row({ id: '2', classification: 'Agent' }),
      row({ id: '3', classification: 'Agent', lead_temp: 'HOT' }),
      row({ id: '4', lead_temp: 'COLD' }),
    ];
    expect(requirementStats(rows)).toEqual({
      total: 4,
      hot: 2,
      buyers: 2,
      agents: 2,
    });
    expect(requirementStats([])).toEqual({
      total: 0,
      hot: 0,
      buyers: 0,
      agents: 0,
    });
  });
});

describe('matchesPriority', () => {
  it('[REQ-004] splits HOT, the warm middle and the cold tail', () => {
    const hot = row({ lead_temp: 'HOT' });
    const cold = row({ lead_temp: 'COLD' });
    const quiet = row({ lead_temp: 'Not Responding' });
    const dead = row({ lead_temp: 'Dead' });
    const none = row({ lead_temp: null });
    expect(hot).toBeTruthy();
    expect(
      [hot, cold, quiet, dead, none].map((r) => matchesPriority(r, 'All'))
    ).toEqual([true, true, true, true, true]);
    expect(
      [hot, cold, quiet, dead, none].map((r) => matchesPriority(r, 'High'))
    ).toEqual([true, false, false, false, false]);
    expect(
      [hot, cold, quiet, dead, none].map((r) => matchesPriority(r, 'Medium'))
    ).toEqual([false, true, true, false, false]);
    expect(
      [hot, cold, quiet, dead, none].map((r) => matchesPriority(r, 'Low'))
    ).toEqual([false, false, false, true, true]);
  });
});

describe('filterRequirements', () => {
  const rows = [
    row({
      id: '1',
      name: 'Asha',
      phone: '+919700606010',
      requirements: '3 BHK near the lake',
      areas_of_interest: ['Brookefield'],
    }),
    row({
      id: '2',
      name: 'Bala',
      classification: 'Agent',
      lead_temp: 'HOT',
      pref_areas: ['AECS Layout'],
      contact_notes: [{ note_text: 'Wants a corner plot' }],
    }),
    row({ id: '3', name: 'Chitra', lead_temp: 'Dead' }),
  ];

  it('[REQ-004] returns everything when nothing is set', () => {
    expect(filterRequirements(rows, EMPTY_REQUIREMENT_FILTERS)).toHaveLength(3);
  });

  it('[REQ-004] searches name, phone, brief, notes and areas', () => {
    const ids = (search: string) =>
      filterRequirements(rows, { ...EMPTY_REQUIREMENT_FILTERS, search }).map(
        (r) => r.id
      );
    expect(ids('asha')).toEqual(['1']);
    expect(ids('9700606010')).toEqual(['1']);
    expect(ids('lake')).toEqual(['1']);
    expect(ids('corner plot')).toEqual(['2']);
    expect(ids('aecs')).toEqual(['2']);
    expect(ids('nobody')).toEqual([]);
  });

  it('[REQ-004] [CTM-008] finds an area under another spelling', () => {
    const ids = (search: string) =>
      filterRequirements(rows, { ...EMPTY_REQUIREMENT_FILTERS, search }).map(
        (r) => r.id
      );
    expect(ids('Brookfield')).toEqual(['1']);
    expect(ids('buyers in Brookfield')).toEqual(['1']);
    expect(ids('Hosur')).toEqual([]);
  });

  it('[REQ-004] combines classification and priority with the search', () => {
    expect(
      filterRequirements(rows, {
        ...EMPTY_REQUIREMENT_FILTERS,
        classification: 'Agent',
      }).map((r) => r.id)
    ).toEqual(['2']);
    expect(
      filterRequirements(rows, {
        ...EMPTY_REQUIREMENT_FILTERS,
        priority: 'High',
      }).map((r) => r.id)
    ).toEqual(['2']);
    expect(
      filterRequirements(rows, {
        ...EMPTY_REQUIREMENT_FILTERS,
        classification: 'Buyer',
        priority: 'High',
      })
    ).toEqual([]);
  });

  it('[REQ-004] reads the brief a requirement profile holds', () => {
    const profiled = row({
      id: '9',
      name: 'Dev',
      requirements: null,
      requirement_profiles: [
        {
          id: 'p1',
          raw_text: 'Villa in Whitefield',
          active: true,
          areas: ['Whitefield'],
        },
      ],
    } as Partial<RequirementRow>);
    const ids = (search: string) =>
      filterRequirements([profiled], {
        ...EMPTY_REQUIREMENT_FILTERS,
        search,
      }).map((r) => r.id);
    expect(ids('Villa in Whitefield')).toEqual(['9']);
    expect(ids('White Field')).toEqual(['9']);
  });
});

describe('activeRequirementFilterCount', () => {
  it('[REQ-004] counts only the narrowing selects', () => {
    expect(activeRequirementFilterCount(EMPTY_REQUIREMENT_FILTERS)).toBe(0);
    expect(
      activeRequirementFilterCount({
        search: 'anything',
        classification: 'Buyer',
        priority: 'All',
      })
    ).toBe(1);
    expect(
      activeRequirementFilterCount({
        search: '',
        classification: 'Buyer',
        priority: 'High',
      })
    ).toBe(2);
  });
});

describe('preference merge', () => {
  it('[REQ-004] lets an explicit value win over the extracted one', () => {
    expect(
      effectiveMaxBudget(row({ max_budget: 5000000, pref_budget_max: 9000000 }))
    ).toEqual({ value: 5000000, source: 'explicit' });
    expect(effectiveMaxBudget(row({ pref_budget_max: 9000000 }))).toEqual({
      value: 9000000,
      source: 'ai',
    });
    expect(effectiveMaxBudget(row({ max_budget: 0 }))).toBeNull();

    expect(
      effectiveAreas(row({ areas_of_interest: ['HSR'], pref_areas: ['BTM'] }))
    ).toEqual({ value: ['HSR'], source: 'explicit' });
    expect(effectiveAreas(row({ areas_of_interest: ['  '] }))).toBeNull();

    expect(
      effectiveCategories(
        row({
          pref_property_categories: ['residential'],
          pref_property_types: ['Flat/ Apartment', 'residential'],
        })
      )
    ).toEqual({ value: ['Residential', 'Flat/ Apartment'], source: 'ai' });
  });

  it('[REQ-004] labels the budget the way the card shows it', () => {
    expect(requirementBudgetLabel(row({ no_budget: true }))).toEqual({
      text: 'No limit',
      ai: false,
    });
    expect(requirementBudgetLabel(row({ pref_budget_max: 15000000 }))).toEqual({
      text: '₹1.50 Cr',
      ai: true,
    });
    expect(requirementBudgetLabel(row({ max_budget: 4500000 }))).toEqual({
      text: '₹45 L',
      ai: false,
    });
    expect(requirementBudgetLabel(row({}))).toEqual({
      text: 'Not specified',
      ai: false,
    });
  });

  it('[REQ-004] formats rupees like the web card', () => {
    expect(requirementCurrency(30000000)).toBe('₹3 Cr');
    expect(requirementCurrency(15500000)).toBe('₹1.55 Cr');
    expect(requirementCurrency(4500000)).toBe('₹45 L');
    expect(requirementCurrency(40000)).toBe('₹40,000');
  });

  it('[REQ-004] hides a suggestion that is already a tag', () => {
    expect(
      visibleTagSuggestions(['Investor', 'NRI', 'investor'], ['nri'])
    ).toEqual(['Investor']);
    expect(visibleTagSuggestions(null, [])).toEqual([]);
  });
});

describe('the add-a-requirement picker', () => {
  it('[REQ-006] offers only the classifications the screen lists', () => {
    expect(REQUIREMENT_OWNER_CLASSIFICATIONS).toEqual(['Buyer', 'Agent']);
  });

  it('[REQ-006] hydrates the brief the sheet will open on', () => {
    // Without these the sheet shows an empty brief for a client who
    // already has one, and saving replaces it.
    for (const column of [
      'id',
      'name',
      'phone',
      'classification',
      'requirements',
      'requirement_profiles',
    ]) {
      expect(REQUIREMENT_CONTACT_COLUMNS, column).toContain(column);
    }
    expect(new Set(REQUIREMENT_CONTACT_COLUMNS).size).toBe(
      REQUIREMENT_CONTACT_COLUMNS.length
    );
  });

  it('[REQ-006] searches name, internal label and phone', () => {
    expect(requirementContactSearchFilter('Asha')).toBe(
      'name.ilike.%Asha%,name_tag.ilike.%Asha%,phone.ilike.%Asha%'
    );
  });

  it('[REQ-006] finds a formatted phone by its digits', () => {
    expect(requirementContactSearchFilter('+91 97006 06010')).toContain(
      'phone.ilike.%919700606010%'
    );
    expect(requirementContactSearchFilter('123')).not.toContain(
      'phone.ilike.%123%,'
    );
  });
});
