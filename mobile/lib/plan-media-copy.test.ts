import { describe, expect, it } from 'vitest';

import { planMediaCopy } from './plan-media-copy';

describe('planMediaCopy', () => {
  it('uses floor terminology for built properties', () => {
    expect(planMediaCopy(false)).toMatchObject({
      heading: 'Floor Plans',
      addAction: 'Add Floor',
      nameLabel: 'Floor',
    });
  });

  it('uses sketch terminology for land', () => {
    expect(planMediaCopy(true)).toMatchObject({
      heading: 'Land Sketches',
      addAction: 'Add Sketch',
      nameLabel: 'Sketch name',
      emptyText: 'No land sketches yet.',
    });
  });
});
