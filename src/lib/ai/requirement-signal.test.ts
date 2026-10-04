import { describe, expect, it } from 'vitest';
import { statesBudget } from './requirement-signal';

describe('[INB-029] statesBudget', () => {
  it('reads every budget form the extraction can file', () => {
    for (const text of [
      'budget 2 cr',
      '₹2,00,00,000',
      'Rs 50 lakh max',
      'my budget is around 200',
      '2,50,00,000 is the max',
    ]) {
      expect(statesBudget(text)).toBe(true);
    }
  });

  it('reads no budget in a message without a figure', () => {
    for (const text of ['near Horamavu', 'budget is flexible', '4 BHK house']) {
      expect(statesBudget(text)).toBe(false);
    }
  });
});
