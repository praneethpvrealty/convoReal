import { describe, expect, it } from 'vitest';
import {
  parseNumberedListing,
  parseOrdinalReferences,
} from './shortlist-reference';

describe('parseOrdinalReferences', () => {
  it('reads the reply that started this', () => {
    // Sent straight after a three-listing digest. The ladder claimed it
    // and asked "what kind of property are you looking for?" — of a
    // buyer offering to drive out to two of them the same day.
    expect(
      parseOrdinalReferences(
        'Can you share location of Options 1 & 2? I will visit today.'
      )
    ).toEqual([1, 2]);
  });

  it('reads a bare number, which is what the bot invites', () => {
    expect(parseOrdinalReferences('2')).toEqual([2]);
    expect(parseOrdinalReferences('1 and 3')).toEqual([1, 3]);
    expect(parseOrdinalReferences('1,2')).toEqual([1, 2]);
  });

  it('reads the markers people actually type', () => {
    expect(parseOrdinalReferences('photos for no. 3 please')).toEqual([3]);
    expect(parseOrdinalReferences('interested in option 2')).toEqual([2]);
    expect(parseOrdinalReferences('send me #1')).toEqual([1]);
    expect(parseOrdinalReferences('listing 2 and 3 look good')).toEqual([2, 3]);
  });

  it('reads a named ordinal only when it names a listing', () => {
    expect(parseOrdinalReferences('the first one please')).toEqual([1]);
    expect(parseOrdinalReferences('I like the third.')).toEqual([3]);
    // Bangalore addresses are full of these. Reading "4th Phase" as
    // listing four would answer a question about a property the buyer
    // never mentioned.
    expect(parseOrdinalReferences('is 1st Block Koramangala ok')).toEqual([]);
    expect(parseOrdinalReferences('JP Nagar 4th Phase works for me')).toEqual(
      []
    );
  });

  it('does not read a quantity as a label', () => {
    for (const text of [
      'under 7-8 cr',
      '2 BHK please',
      'looking for 3400 sqft',
      '40x60 plot',
      'anywhere. its fine, we purchase plot and build 1bhk/studio',
    ]) {
      expect(parseOrdinalReferences(text), text).toEqual([]);
    }
  });

  it('is empty for the ordinary message', () => {
    expect(parseOrdinalReferences('')).toEqual([]);
    expect(parseOrdinalReferences(null)).toEqual([]);
    expect(parseOrdinalReferences('Commercial or Semi commercial')).toEqual([]);
  });
});

describe('parseNumberedListing', () => {
  // Exactly what buildListingLines emits: the title bolded with its
  // number inside, then specs, locality, and the link that carries the
  // id.
  const shortlist = [
    'Thanks Pavan — here are 2 that fit 👇',
    '',
    '*1. Residential Plot in Koramangala*',
    '₹7.70 Cr · 2,200 Sq.Ft.',
    '📍 Koramangala 5th block, Bangalore',
    'https://convoreal.com/?property_id=0f762a3d-cd89-43ae-b011-544e40aa7312&v=e630c87f-7d2f-4e1f-8ea0-6ee2b89dc775',
    '',
    '*2. 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.*',
    '₹8.40 Cr · 2,400 Sq.Ft.',
    '📍 JP Nagar 4th Phase, Bangalore',
    'https://convoreal.com/?property_id=6e3fc698-4010-4726-b385-a81af4dda437&v=e630c87f-7d2f-4e1f-8ea0-6ee2b89dc775',
    '',
    "Want photos or a site visit for any of these? Reply with the number and I'll set it up.",
  ].join('\n');

  it('takes the id straight off the link', () => {
    expect(parseNumberedListing(shortlist)).toEqual([
      {
        ordinal: 1,
        propertyId: '0f762a3d-cd89-43ae-b011-544e40aa7312',
        title: 'Residential Plot in Koramangala',
      },
      {
        ordinal: 2,
        propertyId: '6e3fc698-4010-4726-b385-a81af4dda437',
        title: '2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
      },
    ]);
  });

  it('falls back to the title for the digest, which carries no per-row link', () => {
    const digest = [
      'Hi Pavan 👋',
      '',
      "2 new listings match what you're looking for:",
      '',
      '1. *2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.* — ₹8.4 Cr',
      '   JP Nagar 4th Phase, Bangalore · 2,400 Sq.Ft.',
      '   ✓ Same category · In your area · Within budget',
      '',
      '2. *Commercial Corner Property for Sale in Southend Road* — ₹8.5 Cr',
      '   Southend road, Bangalore · 1,840 Sq.Ft.',
      '',
      'Reply STOP ALERTS to pause these.',
    ].join('\n');

    expect(parseNumberedListing(digest)).toEqual([
      {
        ordinal: 1,
        propertyId: null,
        title: '2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
      },
      {
        ordinal: 2,
        propertyId: null,
        title: 'Commercial Corner Property for Sale in Southend Road',
      },
    ]);
  });

  it('finds nothing in a message that is not a shortlist', () => {
    expect(
      parseNumberedListing(
        'Perfect — commercial land, up to ₹8 Cr. Which area are you looking at?'
      )
    ).toEqual([]);
    // A figure at the start of a spec line is not an entry.
    expect(parseNumberedListing('3400 Sq.Ft. Commercial Land')).toEqual([]);
  });
});
