import { describe, expect, it } from 'vitest';
import type { SubjectThread } from '@/lib/learning/subject';
import { detailsRequestInThread } from './named-share';
import { asksDetailsOfDescribedListing } from './requirement-signal';
import { isBuyerRequirementMessage } from './lead-routing';

const hopefarm = {
  id: 'p-1014',
  property_code: 'PROP-1014',
  title: 'Commercial Rental Income Building for Sale in Hopefarm Whitefield',
  location: 'Hopefarm, Whitefield',
  price: 480_000_000,
  area_sqft: 34_200,
};
const plot = {
  id: 'p-1018',
  property_code: 'PROP-1018',
  title: 'Vacant plot for sale in Whitefield',
  location: 'Pattandur Agrahara, Whitefield',
  price: 43_200_000,
  land_area: 3089,
  land_area_unit: 'sqft',
};
const others = Array.from({ length: 6 }, (_, i) => ({
  id: `p-20${i}`,
  property_code: `PROP-20${i}`,
  title: `Warehouse ${i} for lease in Hoskote`,
  location: 'Hoskote',
  price: 100_000_000 + i * 10_000_000,
}));

function minutesAgo(n: number): string {
  return new Date(Date.UTC(2026, 9, 26, 3, 0) - n * 60_000).toISOString();
}

describe('[INB-043] a details request naming a shared listing is not a requirement', () => {
  const text = 'Commercial property in hope farm 48 cr,  details ?';

  it('reads the reported message as a details request, not a search', () => {
    expect(isBuyerRequirementMessage(text)).toBe(true);
    for (const ask of [
      text,
      'Commercial property in hope farm 48 cr details',
      'Details of the hope farm building',
      '48 cr building details please',
      'tell me about the hope farm one',
    ]) {
      expect(asksDetailsOfDescribedListing(ask), ask).toBe(true);
    }
  });

  it('never reads a thank-you, the lead’s own details or a search as a request', () => {
    for (const other of [
      'Thanks for the details',
      'Thank you for the info',
      'Got the details, will check',
      'Here are my contact details',
      'Sharing my details: Gouri Shankar, F4PR IT',
      'our company details are attached',
      'I have shared complete details',
      'Looking for commercial property 48 cr, details?',
      'Any commercial building under 50 cr? details please',
      'Do you have a 3 BHK in Whitefield',
      'Commercial 48 cr',
      '4 BHK house',
    ]) {
      expect(asksDetailsOfDescribedListing(other), other).toBe(false);
    }
  });

  it('names the listing already shared, by its price', () => {
    const thread: SubjectThread = {
      messages: [],
      shares: [
        { propertyId: plot.id, at: minutesAgo(5) },
        { propertyId: hopefarm.id, at: minutesAgo(20) },
      ],
      candidates: [hopefarm, plot],
    };
    expect(detailsRequestInThread(thread, text)).toBe('p-1014');
  });

  it('finds a listing re-sent in the thread after its ledger row aged out', () => {
    const thread: SubjectThread = {
      messages: [
        {
          sender: 'agent',
          text: 'Commercial Rental Income Building for Sale in Hopefarm Whitefield — PROP-1014',
          at: minutesAgo(1),
        },
      ],
      shares: [
        ...others.map((o, i) => ({ propertyId: o.id, at: minutesAgo(10 + i) })),
        { propertyId: hopefarm.id, at: minutesAgo(600) },
      ],
      candidates: [...others, hopefarm],
    };
    expect(detailsRequestInThread(thread, text)).toBe('p-1014');
  });

  it('names nothing when no recent share carries the figure', () => {
    const thread: SubjectThread = {
      messages: [],
      shares: [{ propertyId: plot.id, at: minutesAgo(5) }],
      candidates: [plot],
    };
    expect(detailsRequestInThread(thread, text)).toBeNull();
  });

  it('names nothing for a message that asks for no details', () => {
    const thread: SubjectThread = {
      messages: [],
      shares: [{ propertyId: hopefarm.id, at: minutesAgo(5) }],
      candidates: [hopefarm],
    };
    expect(detailsRequestInThread(thread, 'Commercial 48 cr')).toBeNull();
    expect(
      detailsRequestInThread(thread, 'Thanks for the 48 cr details')
    ).toBeNull();
  });
});
