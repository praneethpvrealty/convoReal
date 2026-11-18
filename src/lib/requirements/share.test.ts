import { describe, expect, it } from 'vitest';
import {
  buildRequirementDigest,
  formatRequirement,
  isShareable,
  requirementReference,
  type ShareableRequirement,
} from './share';

const base: ShareableRequirement = {
  id: 'a3f2b1c4-1111-2222-3333-444455556666',
  name: 'Ganesh',
  classification: 'Buyer',
  max_budget: 30000000,
  requirements: '2.5 or 3 BHK flat, end use, brother relocating from Mumbai',
  areas_of_interest: ['Hebbal', 'Koramangala'],
  projects_of_interest: ['Purva Westend'],
  tags: ['End User', 'Full Cheque'],
  latestNote: 'Will stretch to 3.3 if pushed',
};

describe('requirementReference', () => {
  it('is stable and carries no identity', () => {
    expect(requirementReference(base.id)).toBe('REQ-A3F2');
    expect(requirementReference(base.id)).toBe(requirementReference(base.id));
  });
});

describe('formatRequirement — masked', () => {
  const masked = formatRequirement(base, 'masked');

  it('withholds the client name', () => {
    expect(masked).not.toContain('Ganesh');
    expect(masked).toContain('REQ-A3F2');
  });

  it('withholds internal notes and tags', () => {
    expect(masked).not.toContain('Will stretch');
    expect(masked).not.toContain('Full Cheque');
  });

  it('keeps the brief a co-broker needs', () => {
    expect(masked).toContain('up to ₹3 Cr');
    expect(masked).toContain('Hebbal, Koramangala');
    expect(masked).toContain('Purva Westend');
    expect(masked).toContain('2.5 or 3 BHK flat');
  });
});

describe('formatRequirement — full', () => {
  const full = formatRequirement(base, 'full');

  it('keeps the agent’s own record intact', () => {
    expect(full).toContain('Client Profile: Ganesh (Buyer)');
    expect(full).toContain('Full Cheque');
    expect(full).toContain('Will stretch to 3.3 if pushed');
  });
});

describe('budget lines', () => {
  it('states a range when both bounds are set', () => {
    expect(
      formatRequirement({ ...base, min_budget: 24000000 }, 'masked')
    ).toContain('₹2.4 Cr – ₹3 Cr');
  });

  it('says so when the client stated no limit', () => {
    expect(
      formatRequirement(
        { ...base, no_budget: true, max_budget: null },
        'masked'
      )
    ).toContain('No limit stated');
  });

  it('does not invent a budget that was never given', () => {
    expect(
      formatRequirement(
        { ...base, max_budget: null, min_budget: null },
        'masked'
      )
    ).not.toContain('Budget');
  });
});

describe('[REQ-007] a crisp brief', () => {
  const noisy: ShareableRequirement = {
    id: '53c4aaaa-0000-0000-0000-000000000000',
    classification: 'Buyer',
    min_budget: 70000000,
    max_budget: 150000000,
    requirements: 'Residential House · Jayanagar, JP Nagar · ₹15 Cr–₹40 Cr',
    areas_of_interest: ['Jayanagar', 'JP Nagar', 'JP Nagar', 'jayanagar '],
  };

  it('repeats neither a location nor a budget the text already states', () => {
    expect(buildRequirementDigest([noisy], 'masked')).toBe(
      [
        '*CLIENT REQUIREMENT*',
        '',
        '• Requirement REQ-53C4 (Buyer)',
        '• Looking for: Residential House · Jayanagar, JP Nagar · ₹15 Cr–₹40 Cr',
      ].join('\n')
    );
  });

  it('lists each remaining location and project once', () => {
    const out = formatRequirement(
      {
        ...noisy,
        requirements: 'Independent house, old building is fine',
        areas_of_interest: ['Jayanagar', 'JP Nagar', 'jp nagar', 'Jayanagar'],
        projects_of_interest: ['Purva Westend', 'purva westend'],
      },
      'masked'
    );
    expect(out).toContain('Budget: ₹7 Cr – ₹15 Cr');
    expect(out).toContain('Locations: Jayanagar, JP Nagar');
    expect(out).not.toContain('JP Nagar, ');
    expect(out).toContain('Projects: Purva Westend');
    expect(out).not.toContain('purva westend');
  });

  it('matches whole words, so part of a name is not taken as stated', () => {
    expect(
      formatRequirement(
        {
          ...noisy,
          requirements: 'Near Jayanagar 4th Block',
          areas_of_interest: ['Nagar', 'Jayanagar'],
        },
        'masked'
      )
    ).toContain('Locations: Nagar');
  });

  it('keeps a no-limit budget even when the text names a figure', () => {
    expect(
      formatRequirement({ ...noisy, no_budget: true }, 'masked')
    ).toContain('Budget: No limit stated');
  });
});

describe('isShareable', () => {
  it('excludes a parked requirement', () => {
    expect(isShareable({ ...base, requirement_active: false })).toBe(false);
  });

  it('includes an active one', () => {
    expect(isShareable({ ...base, requirement_active: true })).toBe(true);
  });

  it('treats a missing flag as active, so existing rows keep working', () => {
    expect(isShareable(base)).toBe(true);
  });

  it('excludes a contact with nothing a co-broker could act on', () => {
    expect(isShareable({ id: base.id, name: 'Empty' })).toBe(false);
  });
});

describe('buildRequirementDigest', () => {
  const second: ShareableRequirement = {
    id: 'bbbb1111-0000-0000-0000-000000000000',
    name: 'Vinoth',
    classification: 'Buyer',
    max_budget: 12000000,
    requirements: '2 BHK in Purva Westend',
  };

  it('keeps the single-requirement heading singular and unnumbered', () => {
    const out = buildRequirementDigest([base], 'masked');
    expect(out).toContain('*CLIENT REQUIREMENT*');
    expect(out).not.toContain('1)');
  });

  it('numbers a multi-requirement digest and counts it', () => {
    const out = buildRequirementDigest([base, second], 'masked');
    expect(out).toContain('*CLIENT REQUIREMENTS (2)*');
    expect(out).toContain('1)');
    expect(out).toContain('2)');
  });

  it('drops parked requirements, and renumbers around them', () => {
    const out = buildRequirementDigest(
      [{ ...base, requirement_active: false }, second],
      'masked'
    );
    expect(out).toContain('*CLIENT REQUIREMENT*');
    expect(out).not.toContain('Hebbal');
    expect(out).toContain('Purva Westend');
  });

  it('is empty when everything is parked, so nothing is sent by accident', () => {
    expect(
      buildRequirementDigest([{ ...base, requirement_active: false }], 'masked')
    ).toBe('');
  });

  it('never leaks a name through the digest path either', () => {
    const out = buildRequirementDigest([base, second], 'masked');
    expect(out).not.toContain('Ganesh');
    expect(out).not.toContain('Vinoth');
  });
});

describe('response links', () => {
  it('appends the respond line in both modes when a link was minted', () => {
    const withLink = { ...base, responseUrl: 'https://x.example/req/tok123' };
    expect(formatRequirement(withLink, 'masked')).toContain(
      'Respond here: https://x.example/req/tok123'
    );
    expect(formatRequirement(withLink, 'full')).toContain(
      'Respond here: https://x.example/req/tok123'
    );
  });

  it('adds nothing without one', () => {
    expect(formatRequirement(base, 'masked')).not.toContain('Respond here');
  });
});
