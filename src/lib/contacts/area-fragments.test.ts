import { describe, expect, it } from 'vitest';
import { isAreaFragment, sanitizeAreaList } from './area-fragments';

describe('isAreaFragment', () => {
  it('[CTM-010] flags door, survey and street numbers seen filed as buyer areas', () => {
    for (const fragment of [
      '#365',
      '#650',
      '# 1',
      '436',
      '571-565',
      'Sy. No. 153/3',
      'Block',
      'Sector',
      'Phase',
      '24th Main',
      '12a Main',
      '7th cross Road',
      '6th Block',
    ]) {
      expect(isAreaFragment(fragment), fragment).toBe(true);
    }
  });

  it('[CTM-010] keeps localities that carry a block, sector, phase or road', () => {
    for (const locality of [
      'HSR Layout 2nd Sector',
      'Sector 6 HSR Layout',
      'Koramangala 1st Block',
      'Block 3rd Koramangala',
      'JP Nagar 4th Phase',
      'Surya City Phase II',
      'Banashankari 2nd Stage',
      '24th main - JP Nagar',
      '100 feet road',
      'Outer Ring Road',
      'HSR',
      'BTM',
      'KR Puram',
    ]) {
      expect(isAreaFragment(locality), locality).toBe(false);
    }
  });
});

describe('sanitizeAreaList', () => {
  it('[CTM-010] splits joined entries, drops fragments and keeps each area once', () => {
    expect(
      sanitizeAreaList([
        '#365',
        'JP Nagar',
        'Dabaspete\nChikatirupati road \nHoskote',
        'Thanisandra.',
        'jp nagar',
        'Block',
        42,
      ])
    ).toEqual([
      'JP Nagar',
      'Dabaspete',
      'Chikatirupati road',
      'Hoskote',
      'Thanisandra',
    ]);
  });
});
