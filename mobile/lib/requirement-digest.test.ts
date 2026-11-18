import { describe, expect, it } from 'vitest';

import {
  buildRequirementDigest,
  formatRequirement,
  isShareable,
  requirementReference,
  type ShareableRequirement,
} from './requirement-digest';

const brief = (
  patch: Partial<ShareableRequirement> = {}
): ShareableRequirement => ({
  id: 'a3f2c1d0-1111-2222-3333-444455556666',
  name: 'Asha Rao',
  classification: 'Buyer',
  requirements: '3 BHK near the lake',
  areas_of_interest: ['Brookefield'],
  max_budget: 15000000,
  ...patch,
});

describe('requirementReference', () => {
  it('[REQ-005] is a stable opaque handle', () => {
    expect(requirementReference('a3f2c1d0-1111-2222-3333-444455556666')).toBe(
      'REQ-A3F2'
    );
  });
});

describe('isShareable', () => {
  it('[REQ-005] refuses a parked or empty brief', () => {
    expect(isShareable(brief())).toBe(true);
    expect(isShareable(brief({ requirement_active: false }))).toBe(false);
    expect(
      isShareable({ id: 'x', requirements: '  ', areas_of_interest: [] })
    ).toBe(false);
    expect(isShareable({ id: 'x', no_budget: true })).toBe(true);
  });
});

describe('formatRequirement', () => {
  it('[REQ-005] withholds name, tags and notes when masked', () => {
    const masked = formatRequirement(
      brief({ tags: ['Investor'], latestNote: 'will stretch if pushed' }),
      'masked'
    );
    expect(masked).toContain('Requirement REQ-A3F2 (Buyer)');
    expect(masked).toContain('Looking for: 3 BHK near the lake');
    expect(masked).not.toContain('Asha Rao');
    expect(masked).not.toContain('Investor');
    expect(masked).not.toContain('will stretch');
  });

  it('[REQ-005] carries them in full mode', () => {
    const full = formatRequirement(
      brief({ tags: ['Investor'], latestNote: 'will stretch if pushed' }),
      'full'
    );
    expect(full).toContain('Client Profile: Asha Rao (Buyer)');
    expect(full).toContain('Requirements: 3 BHK near the lake');
    expect(full).toContain('Tags: Investor');
    expect(full).toContain('Notes: will stretch if pushed');
  });

  it('[REQ-005] states the budget every way it can be known', () => {
    expect(formatRequirement(brief({ no_budget: true }), 'masked')).toContain(
      'Budget: No limit stated'
    );
    expect(formatRequirement(brief(), 'masked')).toContain(
      'Budget: up to ₹1.5 Cr'
    );
    expect(
      formatRequirement(brief({ min_budget: 5000000 }), 'masked')
    ).toContain('Budget: ₹50 L – ₹1.5 Cr');
    expect(
      formatRequirement(
        brief({ max_budget: null, min_budget: 5000000 }),
        'masked'
      )
    ).toContain('Budget: from ₹50 L');
    expect(
      formatRequirement(brief({ max_budget: null }), 'masked')
    ).not.toContain('Budget');
  });

  it('[REQ-007] repeats neither a location nor a budget the text states', () => {
    const out = formatRequirement(
      brief({
        requirements: 'House · Jayanagar, JP Nagar · ₹15 Cr–₹40 Cr',
        areas_of_interest: ['Jayanagar', 'JP Nagar', 'JP Nagar', 'Jayanagar'],
        min_budget: 70000000,
        max_budget: 150000000,
      }),
      'masked'
    );
    expect(out).not.toContain('Locations');
    expect(out).not.toContain('Budget');
    expect(
      formatRequirement(
        brief({ areas_of_interest: ['Brookefield', 'brookefield '] }),
        'masked'
      )
    ).toMatch(/Locations: Brookefield$/);
  });

  it('[REQ-005] appends a response link when one was minted', () => {
    expect(
      formatRequirement(
        brief({ responseUrl: 'https://x.test/req/t' }),
        'masked'
      )
    ).toContain('Got a match? Respond here: https://x.test/req/t');
  });
});

describe('buildRequirementDigest', () => {
  it('[REQ-005] numbers past the first and drops unsendable briefs', () => {
    expect(buildRequirementDigest([], 'masked')).toBe('');
    expect(
      buildRequirementDigest([brief({ requirement_active: false })], 'masked')
    ).toBe('');

    const one = buildRequirementDigest([brief()], 'masked');
    expect(one).toContain('*CLIENT REQUIREMENT*');
    expect(one).not.toContain('1)');

    const two = buildRequirementDigest(
      [brief(), brief({ id: 'b1b2c3d4-0000-0000-0000-000000000000' })],
      'masked'
    );
    expect(two).toContain('*CLIENT REQUIREMENTS (2)*');
    expect(two).toContain('1) •');
    expect(two).toContain('2) •');
  });
});
