import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const route = readFileSync(
    join(
      process.cwd(),
      'src/app/api/contacts/[id]/requirements/route.ts'
    ),
    'utf8'
  );

  it('deletes one additional profile without deleting the contact or siblings', () => {
    expect(route).toContain(
      'profiles.filter((profile) => profile.id !== profileId)'
    );
    expect(route).toContain('requirement_profiles: remaining');
    expect(route).not.toContain(".from('contacts')\n      .delete()");
  });

  it('clears only primary requirement fields when deleting the primary brief', () => {
    const deletion = route.slice(route.indexOf('export async function DELETE'));
    expect(deletion).toContain('requirements: null');
    expect(deletion).toContain('requirement_active: profiles.length > 0');
    expect(deletion).not.toContain('requirement_profiles: []');
  });

  it('keeps editing and deleting available on web and mobile', () => {
    const surfaces = [
      'src/components/contacts/contact-requirements-dialog.tsx',
      'mobile/components/contact-requirements-sheet.tsx',
    ].map((file) => readFileSync(join(process.cwd(), file), 'utf8'));
    for (const surface of surfaces) {
      expect(surface).toContain('Save changes');
      expect(surface).toContain('deleteRequirement');
      expect(surface).toContain('Delete');
    }
  });
});
