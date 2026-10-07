import { describe, expect, it } from 'vitest';
import {
  asksAboutSharedListing,
  carriesRequirementSignal,
  statesBudget,
} from './requirement-signal';

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

describe('[INB-032] a question about the listing in the thread is not a requirement', () => {
  it('reads the questions that used to be filed as requirements and answered with silence', () => {
    for (const text of [
      'Is it this pink house or house next to it ?',
      'Is this house 3 BHK?',
      'is the plot corner site',
      'Is it a villa or an apartment?',
      'Does this flat have parking?',
      'Is this still for sale',
    ]) {
      expect(asksAboutSharedListing(text), text).toBe(true);
      expect(carriesRequirementSignal(text), text).toBe(false);
    }
  });

  it('keeps a question that states a budget, a size or an intent with the ladder', () => {
    for (const text of [
      'Do you have any villa under 2 Cr?',
      'Is this house within 1.5 cr budget?',
      'can I get a 30x40 site in this area?',
      'Which villa do you have in HSR',
      'Are there any 3 BHK flats you can show me?',
      'I am looking for a house like this one',
    ]) {
      expect(asksAboutSharedListing(text), text).toBe(false);
      expect(carriesRequirementSignal(text), text).toBe(true);
    }
  });

  it('leaves a plain requirement alone', () => {
    for (const text of [
      '4 BHK house',
      'Land , 1.5 to 2cr',
      'plot of 1,200 sqft',
    ]) {
      expect(asksAboutSharedListing(text), text).toBe(false);
      expect(carriesRequirementSignal(text), text).toBe(true);
    }
  });
});
