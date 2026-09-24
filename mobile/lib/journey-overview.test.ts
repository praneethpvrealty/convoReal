import { describe, expect, it } from 'vitest';

import {
  focusBuckets,
  journeyRaceLabel,
  splitItemsAtStage,
} from './journey-overview';

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

describe('splitItemsAtStage', () => {
  const rows = [
    { id: 'a', stage_id: 'new', status: 'active' },
    { id: 'b', stage_id: 'token', status: 'active' },
    { id: 'c', stage_id: 'new', status: 'dropped' },
  ];

  it('[JRN-008] leads with the live items on the group stage and folds the rest', () => {
    expect(splitItemsAtStage(rows, 'token')).toEqual({
      atStage: [rows[1]],
      elsewhere: [rows[0], rows[2]],
    });
    expect(splitItemsAtStage(rows, null)).toEqual({
      atStage: rows,
      elsewhere: [],
    });
  });

  it('[JRN-008] leads with the dropped items inside the lost stage group', () => {
    expect(splitItemsAtStage(rows, 'lost', true)).toEqual({
      atStage: [rows[2]],
      elsewhere: [rows[0], rows[1]],
    });
  });
});
