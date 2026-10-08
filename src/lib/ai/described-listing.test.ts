import { describe, expect, it } from 'vitest';
import {
  describedListingAmong,
  referencesSharedListing,
} from './described-listing';

// The two cards that went to one buyer forty-eight seconds apart on
// 7 October 2026, and the correction the bot never answered.
const CHIKATOGUR = {
  id: 'prop-1784',
  title: '40,000 Sq.Ft. Commercial Plot in Chikatogur, Electronic City Phase 1',
  location: 'Chikatogur, Electronic City Phase 1',
  sublocality: 'Chikkathoguru',
  project: null,
  price: '160000000',
  area_sqft: null,
  land_area: '40000',
  land_area_unit: 'Sq.Ft.',
  bedrooms: null,
};
const JP_NAGAR = {
  id: 'prop-2080',
  title: '5,760 Sq.Ft. Commercial Property in JP Nagar 8th Phase',
  location: 'BK Circle, JP Nagar 8th Phase',
  sublocality: 'Kothnur',
  project: null,
  price: 132480000,
  area_sqft: 5760,
  land_area: null,
  land_area_unit: 'Sq.Ft.',
  bedrooms: null,
};
const FLAT = {
  id: 'prop-flat',
  title: '3 BHK Apartment in Whitefield',
  location: 'Whitefield',
  sublocality: 'Whitefield',
  project: 'Prestige Lakeside Habitat',
  price: 21000000,
  area_sqft: 1650,
  land_area: null,
  land_area_unit: null,
  bedrooms: 3,
};

describe('referencesSharedListing', () => {
  it('[INB-034] reads the correction that went unanswered', () => {
    expect(referencesSharedListing('No this 40,000 sqft one')).toBe(true);
    expect(referencesSharedListing('I meant the 16 Cr plot')).toBe(true);
    expect(referencesSharedListing('that 3 BHK one please')).toBe(true);
  });

  it('[INB-034] leaves a stated requirement to the ladder', () => {
    expect(referencesSharedListing('I want a 2400 sqft plot')).toBe(false);
    expect(referencesSharedListing('looking for 3 bhk in Whitefield')).toBe(
      false
    );
    expect(referencesSharedListing('budget 2 cr')).toBe(false);
  });

  it('[INB-034] needs a figure, not just a demonstrative', () => {
    expect(referencesSharedListing('this one')).toBe(false);
    expect(referencesSharedListing('Location is here')).toBe(false);
    expect(referencesSharedListing('')).toBe(false);
    expect(referencesSharedListing(null)).toBe(false);
  });
});

describe('describedListingAmong', () => {
  const shared = [JP_NAGAR, CHIKATOGUR, FLAT];

  it('[INB-034] picks the listing whose land area the buyer named', () => {
    expect(describedListingAmong('No this 40,000 sqft one', shared)).toBe(
      'prop-1784'
    );
    expect(describedListingAmong('the 40000 sft plot', shared)).toBe(
      'prop-1784'
    );
  });

  it('[INB-034] picks by built-up area, price or bedrooms', () => {
    expect(describedListingAmong('the 5760 sq ft one', shared)).toBe(
      'prop-2080'
    );
    expect(describedListingAmong('I meant the 16 cr one', shared)).toBe(
      'prop-1784'
    );
    expect(describedListingAmong('the 13.25 crore property', shared)).toBe(
      'prop-2080'
    );
    expect(describedListingAmong('that 3 bhk one', shared)).toBe('prop-flat');
  });

  it('[INB-034] picks by a word only one listing carries', () => {
    expect(describedListingAmong('where is the Chikatogur one?', shared)).toBe(
      'prop-1784'
    );
    expect(describedListingAmong('the Kothnur one', shared)).toBe('prop-2080');
    expect(describedListingAmong('the Prestige one', shared)).toBe('prop-flat');
  });

  it('[INB-034] names nothing when the description fits several or none', () => {
    expect(describedListingAmong('the commercial one', shared)).toBeNull();
    expect(describedListingAmong('the 2400 sqft one', shared)).toBeNull();
    expect(describedListingAmong('where exactly is it?', shared)).toBeNull();
    expect(describedListingAmong('No this 40,000 sqft one', [])).toBeNull();
  });

  it('[INB-034] does not let a figure that fits nothing fall through to a loose word match', () => {
    expect(describedListingAmong('the 9000 sqft Chikatogur one', shared)).toBe(
      'prop-1784'
    );
    expect(describedListingAmong('the 9000 sqft one', shared)).toBeNull();
  });
});
