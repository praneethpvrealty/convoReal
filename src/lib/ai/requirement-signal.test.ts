import { describe, expect, it } from 'vitest';
import { carriesRequirementSignal, statesBudget } from './requirement-signal';

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
    for (const text of [
      'near Horamavu',
      'budget is flexible',
      '4 BHK house',
      'looking for a 4 BHK within the budget for a 4 BHK house',
      'budget for 3 bedrooms',
      'plot of 1,200 sqft',
    ]) {
      expect(statesBudget(text)).toBe(false);
    }
  });

  it('lets every budget form through the qualification gate', () => {
    for (const text of ['₹2,00,00,000', 'my budget is around 200']) {
      expect(carriesRequirementSignal(text)).toBe(true);
    }
  });
});
