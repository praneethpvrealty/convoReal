import { describe, expect, it } from 'vitest';
import { isRadarContactClassification } from './engine';

describe('isRadarContactClassification', () => {
  it.each(['Buyer', 'Owner & Buyer', 'Agent'])(
    'keeps %s eligible for Match Radar',
    (classification) => {
      expect(isRadarContactClassification(classification)).toBe(true);
    }
  );

  it.each(['Owner', 'Seller', 'Developer', 'Others', null])(
    'does not treat %s as a buyer requirement',
    (classification) => {
      expect(isRadarContactClassification(classification)).toBe(false);
    }
  );
});
