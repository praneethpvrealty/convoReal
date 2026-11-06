import { describe, expect, it } from 'vitest';

import { requirementsTruncationNotice } from './list-limit';

describe('[UIX-013] requirements list truncation', () => {
  it('says nothing when every requirement is shown', () => {
    expect(requirementsTruncationNotice(12, 12)).toBeNull();
    expect(requirementsTruncationNotice(0, 0)).toBeNull();
  });

  it('says how many are shown out of the total when capped', () => {
    expect(requirementsTruncationNotice(1000, 1450)).toBe(
      'Showing the newest 1,000 of 1,450 requirements.'
    );
  });
});
