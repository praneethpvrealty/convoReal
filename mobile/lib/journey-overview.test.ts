import { describe, expect, it } from 'vitest';

import { focusBuckets, journeyRaceLabel } from './journey-overview';

describe('focusBuckets', () => {
  const buckets = [
    { key: 'stage:new', groups: 91 },
    { key: 'stage:negotiation', groups: 2 },
    { key: 'stage:won', groups: 1 },
  ];

  it('[JRN-006] shows every stage card until one is selected', () => {
    expect(focusBuckets(buckets, null)).toBe(buckets);
  });

  it('[JRN-006] hides the other stage cards while one is selected', () => {
    expect(focusBuckets(buckets, 'stage:negotiation')).toEqual([
      { key: 'stage:negotiation', groups: 2 },
    ]);
  });

  it('[JRN-006] falls back to every stage card when the selected one is gone', () => {
    expect(focusBuckets(buckets, 'closed:completed')).toBe(buckets);
    expect(focusBuckets([], 'stage:new')).toEqual([]);
  });
});

describe('journeyRaceLabel', () => {
  it('[JRN-007] counts what is still in the race and says so plainly at zero', () => {
    expect(journeyRaceLabel(3)).toBe('3 in the race');
    expect(journeyRaceLabel(0)).toBe('Nothing in the race');
  });
});
