import { describe, expect, it } from 'vitest';

import { buildAccountRequirementBrief } from './account-share';

const requirement = {
  id: 'a1b2c3d4-0000-4000-8000-000000000000',
  classification: 'Buyer',
  requirements: '3 BHK near the metro; call only after 6 PM',
  requirement_active: true,
  no_budget: false,
  min_budget: 12_000_000,
  max_budget: null,
  pref_budget_min: null,
  pref_budget_max: 18_000_000,
  areas_of_interest: ['Indiranagar', '  Indiranagar  '],
  pref_areas: ['Domlur'],
  projects_of_interest: ['Project One'],
  pref_projects: ['Project Two'],
  property_interests: ['Apartment'],
  pref_property_categories: ['Residential'],
  pref_property_types: ['Apartment'],
};

describe('[REQ-001] direct account requirement sharing', () => {
  it('builds a useful brief under an opaque reference', () => {
    expect(buildAccountRequirementBrief(requirement)).toEqual({
      reference: 'REQ-A1B2',
      classification: 'Buyer',
      requirements: requirement.requirements,
      noBudget: false,
      minBudget: 12_000_000,
      maxBudget: 18_000_000,
      areas: ['Indiranagar', 'Domlur'],
      projects: ['Project One', 'Project Two'],
      propertyTypes: ['Apartment', 'Residential'],
    });
  });

  it('cannot structurally carry buyer identity or contact details', () => {
    const brief = buildAccountRequirementBrief(requirement);
    expect(brief).not.toHaveProperty('name');
    expect(brief).not.toHaveProperty('phone');
    expect(brief).not.toHaveProperty('email');
    expect(brief).not.toHaveProperty('contactId');
  });
});

describe('[REQ-002] saved requirement lifecycle', () => {
  it('keeps primary and additional briefs as separate source records', () => {
    expect(requirement.requirements).toBeTruthy();
    expect(buildAccountRequirementBrief(requirement).requirements).toBe(
      requirement.requirements
    );
  });
});
