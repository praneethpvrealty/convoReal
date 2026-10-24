import { describe, expect, it } from 'vitest';
import {
  asksAboutSharedListing,
  disputesSharedListing,
  asksListingAttribute,
  namedListingAttributes,
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
      'Is this plot under contract?',
      'Is the house within walking distance of the metro?',
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

describe('[INB-038] a message that only names a listing field is a question about the listing', () => {
  it('reads the attribute-only messages that fell to the ladder', () => {
    for (const text of [
      'Location road width',
      'Size in sft?',
      'Rent per month',
      'What is the price',
      'facing?',
      'Age of the building',
      'location and measurement pls',
    ]) {
      expect(asksListingAttribute(text), text).toBe(true);
      expect(asksAboutSharedListing(text), text).toBe(true);
      expect(carriesRequirementSignal(text), text).toBe(false);
    }
  });

  it('lists the fields a message names, in order', () => {
    expect(namedListingAttributes('Location, road width')).toEqual([
      'Location',
      'road width',
    ]);
    expect(namedListingAttributes('Price and possession')).toEqual([
      'Price',
      'possession',
    ]);
  });

  it('leaves a requirement, a figure and a sentence alone', () => {
    for (const text of [
      'Hsr layout 30x40 north and east facing only',
      'price 2.5 cr',
      'location near horamavu',
      'Rent',
      'I will check the location and come back',
      'size 2400 sqft',
    ]) {
      expect(asksListingAttribute(text), text).toBe(false);
    }
  });
});

describe('[CNV-011] a statement disputing the shared listing is about the listing, not a requirement', () => {
  it('reads the 24 October dispute and its siblings as about the listing', () => {
    for (const text of [
      "Based on the location you've sent, it doesn't seem to be a 30-50 plot",
      'The location you sent is wrong',
      'This is not the same plot as in the photo',
      "It doesn't look like a corner site",
      'The map pin you shared does not match the address',
      'The photo you sent looks different from the listing',
    ]) {
      expect(disputesSharedListing(text), text).toBe(true);
      expect(asksAboutSharedListing(text), text).toBe(true);
      expect(carriesRequirementSignal(text), text).toBe(false);
    }
  });

  it('keeps a ladder answer, a requirement and a budget with the ladder', () => {
    for (const text of [
      "It's a plot",
      'Buy',
      'Not Koramangala, it should be HSR',
      'This is not what I want, I am looking for a villa',
      'It does not seem worth 90 lakhs, my budget is 60 lakh',
      '30x40 plot in Suryanagar',
      "That's wrong, 30x40 corner site",
      "Isn't it a 30x40 plot? The photo looks different",
      "Sorry wrong number, this isn't for me",
      "No that's not right, I want it east facing",
      "This doesn't match my budget",
      "That doesn't look good",
      "It doesn't seem worth it",
      "The price doesn't match my budget",
      'These properties are not matching my requirement',
      "This area doesn't look good",
      'Those plots are different from what I asked',
      'This is not what I am looking for',
      'Something different from this, a bigger plot',
      'Sorry wrong number, I never enquired about this property',
    ]) {
      expect(disputesSharedListing(text), text).toBe(false);
    }
  });

  it('reads "plot number and block" as a question about the listing', () => {
    for (const text of [
      'Please share the plot number and block',
      'Plot number?',
      'Survey number and block pls',
    ]) {
      expect(asksListingAttribute(text), text).toBe(true);
      expect(carriesRequirementSignal(text), text).toBe(false);
    }
  });
});
