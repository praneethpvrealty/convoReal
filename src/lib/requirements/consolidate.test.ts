import { describe, expect, it } from 'vitest';

import {
  consolidationInputs,
  consolidationPrompt,
  formatConsolidatedDigest,
  mergedCount,
  sanitizeConsolidation,
} from './consolidate';

const posted = [
  {
    id: 'a1a10000-0000-0000-0000-000000000000',
    name: 'Balamurali',
    phone: '+919353034849',
    classification: 'Buyer',
    requirements: '1851 sq.ft. flat in Prestige Meridian, east facing',
    max_budget: 21500000,
    areas_of_interest: ['Whitefield', 'whitefield'],
    tags: ['Magic Bricks Lead'],
    latestNote: 'will stretch if pushed',
  },
  {
    id: 'b2b20000-0000-0000-0000-000000000000',
    name: 'Abhishek',
    classification: 'Buyer',
    requirements: '3 BHK in Prestige Meridian Park',
    max_budget: 21500000,
  },
  {
    id: 'c3c30000-0000-0000-0000-000000000000',
    name: 'Manju',
    classification: 'Buyer',
    requirements: 'Commercial building in Koramangala',
    max_budget: 340000000,
  },
  { id: 'd4d40000-0000-0000-0000-000000000000', name: 'Nothing to send' },
  { id: 'a1a10000-0000-0000-0000-000000000000', requirements: 'repeat' },
];

describe('[REQ-008] what the model is shown', () => {
  const inputs = consolidationInputs(posted);

  it('keeps only sendable briefs, once each, under throwaway keys', () => {
    expect(inputs.map((input) => input.key)).toEqual(['r1', 'r2', 'r3']);
    expect(inputs.map((input) => input.reference)).toEqual([
      'REQ-A1A1',
      'REQ-B2B2',
      'REQ-C3C3',
    ]);
  });

  it('never carries a name, phone, tag, note or reference', () => {
    const prompt = consolidationPrompt(inputs);
    for (const secret of [
      'Balamurali',
      'Abhishek',
      '9353034849',
      'Magic Bricks',
      'will stretch',
      'REQ-',
    ]) {
      expect(prompt).not.toContain(secret);
    }
    expect(prompt).toContain('Prestige Meridian');
    expect(prompt).toContain('Locations: Whitefield');
  });

  it('reads nothing from a body that is not a list', () => {
    expect(consolidationInputs({ briefs: 1 })).toEqual([]);
    expect(consolidationInputs(null)).toEqual([]);
  });
});

describe('[REQ-008] what the model may decide', () => {
  const inputs = consolidationInputs(posted);

  it('merges the briefs it groups and words them once', () => {
    const groups = sanitizeConsolidation(
      {
        groups: [
          {
            keys: ['r1', 'r2'],
            looking_for: '3 BHK flat, about 1850 sq.ft., east facing',
            budget: 'up to ₹2.15 Cr',
            locations: ['Whitefield'],
            projects: ['Prestige Meridian Park', 'prestige meridian park'],
          },
          { keys: ['r3'], looking_for: 'Commercial building' },
        ],
      },
      inputs
    );
    expect(mergedCount(groups)).toBe(1);
    expect(formatConsolidatedDigest(groups)).toBe(
      [
        '*CLIENT REQUIREMENTS (2, from 3 clients)*',
        '',
        '1) • 2 clients (REQ-A1A1, REQ-B2B2)',
        '• Budget: up to ₹2.15 Cr',
        '• Looking for: 3 BHK flat, about 1850 sq.ft., east facing',
        '• Locations: Whitefield',
        '• Projects: Prestige Meridian Park',
        '',
        '2) • Requirement REQ-C3C3 (Buyer)',
        '• Budget: up to ₹34 Cr',
        '• Looking for: Commercial building in Koramangala',
      ].join('\n')
    );
  });

  it('sends every brief exactly once whatever the model returns', () => {
    const groups = sanitizeConsolidation(
      {
        groups: [
          { keys: ['r1', 'r9', 'r1'], looking_for: 'Flat' },
          { keys: ['r1', 'r2'], looking_for: '' },
          { keys: 'r3' },
          null,
        ],
      },
      inputs
    );
    expect(groups.flatMap((group) => group.references).sort()).toEqual([
      'REQ-A1A1',
      'REQ-B2B2',
      'REQ-C3C3',
    ]);
    expect(groups.every((group) => group.single)).toBe(true);
  });

  it('falls back to the plain digest when the answer is unusable', () => {
    for (const answer of [null, 'nope', { groups: 'x' }, []]) {
      const groups = sanitizeConsolidation(answer, inputs);
      expect(groups).toHaveLength(3);
      expect(mergedCount(groups)).toBe(0);
      expect(formatConsolidatedDigest(groups)).toContain(
        '*CLIENT REQUIREMENTS (3)*'
      );
    }
  });

  it('strips contact details the model echoes into a merged line', () => {
    const [group] = sanitizeConsolidation(
      {
        groups: [
          {
            keys: ['r1', 'r2'],
            looking_for:
              'Flat, call +91 93530 34849 or a@b.com, see https://x.test/p',
            budget: '₹2 Cr',
          },
        ],
      },
      inputs
    );
    expect(group.lookingFor).toBe('Flat, call or see');
    expect(group.budget).toBe('₹2 Cr');
  });

  it('keeps numeric ranges while stripping phone numbers', () => {
    const [group] = sanitizeConsolidation(
      {
        groups: [
          {
            keys: ['r1', 'r2'],
            looking_for:
              'Flat of 1800 - 2200 sq.ft., ring 098450 12345 or 9845012345',
            budget: '50000 - 75000 per month',
          },
        ],
      },
      inputs
    );
    expect(group.lookingFor).toBe('Flat of 1800 - 2200 sq.ft., ring or');
    expect(group.budget).toBe('50000 - 75000 per month');
  });

  it('sends an unmerged brief whole, however long it is', () => {
    const long = `${'Corner plot with a borewell. '.repeat(40)}Must face east.`;
    const longInputs = consolidationInputs([
      { id: 'e5e50000-0000-0000-0000-000000000000', requirements: long },
      ...posted,
    ]);
    expect(consolidationPrompt(longInputs)).not.toContain('Must face east.');
    const digest = formatConsolidatedDigest(
      sanitizeConsolidation(
        { groups: [{ keys: ['r2', 'r3'], looking_for: '3 BHK flat' }] },
        longInputs
      )
    );
    expect(digest).toContain('2 clients (REQ-A1A1, REQ-B2B2)');
    expect(digest).toContain(`Looking for: ${long}`);
  });
});
