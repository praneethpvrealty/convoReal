import { describe, expect, it } from 'vitest';
import {
  buildContactSearchAnswer,
  contactListFilterParams,
  contactSearchFromPreferences,
  contactSearchListUrl,
  describeContactSearch,
  hasSearchCriteria,
  isContactSearchQuestion,
  parseContactSearchQuery,
} from './contact-search';
import { EMPTY_PREFERENCES } from '@/lib/ai/preference-types';

describe('isContactSearchQuestion', () => {
  it.each([
    'Contact who is looking for residential property in JP Nagar',
    'contacts looking for 3 bhk in HSR Layout under 2 cr',
    'which buyers want villas in Whitefield',
    'show me leads interested in plots near Sarjapur',
    'find clients with budget above 1 cr for commercial',
    'do we have anyone looking for farmland in Kanakapura',
    'is there a buyer for 2bhk flat in Koramangala',
    'koi buyer hai jo JP Nagar mein flat chahiye',
    'buyers in Jayanagar',
  ])('[CPL-003] recognises "%s"', (message) => {
    expect(isContactSearchQuestion(message)).toBe(true);
  });

  it.each([
    'Why are my leads not showing up in the inbox?',
    'Is there a way to tag contacts in bulk?',
    'Which leads came in today?',
    'show me leads from Facebook ads',
    'Leads not coming in from MagicBricks',
    'Can I import contacts with a CSV?',
    'Show deals for client Ramesh',
    'Which contacts replied to my campaign?',
    'Who needs to approve templates?',
    'Do we have any 3 BHK flats in HSR for my client?',
    'Find a property for my buyer in JP Nagar',
    'contacts in |',
    'contacts near me',
    'How do I add a contact?',
    'how to find contacts in the app',
    'Add a contact who is looking for a flat in JP Nagar',
    'share the property with contacts who enquired',
    'What is a lead temperature?',
    'open @Praveen',
    'send a broadcast to all buyers',
  ])('[CPL-003] leaves "%s" to the other intents', (message) => {
    expect(isContactSearchQuestion(message)).toBe(false);
  });
});

describe('parseContactSearchQuery', () => {
  it('[CPL-003] reads area, category and locality stems from the reported question', () => {
    const query = parseContactSearchQuery(
      'Contact who is looking for residential property in JP Nagar'
    );
    expect(query.areas).toEqual(['JP Nagar']);
    expect(query.areaProbes).toEqual([['jp']]);
    expect(query.categories).toEqual(['residential']);
    expect(query.propertyTypes).toEqual([]);
    expect(query.typeProbes).toContain('residential');
    expect(query.typeProbes).toContain('flat');
    expect(query.budgetMax).toBeNull();
    expect(hasSearchCriteria(query)).toBe(true);
  });

  it('reads BHK, budget ceiling and a specific type', () => {
    const query = parseContactSearchQuery(
      'leads interested in 3 bhk flats in HSR Layout under 2 cr'
    );
    expect(query.areas).toEqual(['HSR Layout']);
    expect(query.areaProbes).toEqual([['hsr']]);
    expect(query.bhkMin).toBe(3);
    expect(query.bhkMax).toBe(3);
    expect(query.budgetMax).toBe(20_000_000);
    expect(query.propertyTypes).toEqual(['Flat/ Apartment']);
    expect(query.typeProbes).toEqual(['flat', 'apartment']);
  });

  it('reads a budget band and rent intent', () => {
    const query = parseContactSearchQuery(
      'tenants looking to rent a villa in Whitefield between 80 lakh and 1.2 cr'
    );
    expect(query.budgetMin).toBe(8_000_000);
    expect(query.budgetMax).toBe(12_000_000);
    expect(query.listingTypes).toEqual(['Rent']);
    expect(query.propertyTypes).toEqual(['Villa']);
    expect(query.areas).toEqual(['Whitefield']);
  });

  it('reads a bare-crore budget floor and a plot category', () => {
    const query = parseContactSearchQuery(
      'buyers for plots near Sarjapur Road above 1.5 cr'
    );
    expect(query.areas).toEqual(['Sarjapur Road']);
    expect(query.areaProbes).toEqual([['sarjapur']]);
    expect(query.categories).toEqual(['plot']);
    expect(query.budgetMin).toBe(15_000_000);
  });

  it('keeps multi-word localities whole and strips trailing designators', () => {
    expect(
      parseContactSearchQuery('contacts looking in Electronic City area').areas
    ).toEqual(['Electronic City']);
    expect(
      parseContactSearchQuery('buyers near Kanakapura Road for farmland').areas
    ).toEqual(['Kanakapura Road']);
  });

  it('ignores a negated category', () => {
    const query = parseContactSearchQuery(
      'buyers in Hebbal who want residential, not commercial'
    );
    expect(query.categories).toEqual(['residential']);
  });

  it('[CPL-003] reports no criteria for a bare contact question', () => {
    const query = parseContactSearchQuery('which contacts are looking?');
    expect(hasSearchCriteria(query)).toBe(false);
  });
});

describe('parseContactSearchQuery review cases', () => {
  it('never reads a BHK, size, year or measurement as money', () => {
    expect(
      parseContactSearchQuery('buyers looking for 2 or 3 BHK in HSR')
    ).toMatchObject({
      bhkMin: 2,
      bhkMax: 3,
      budgetMax: null,
    });
    expect(
      parseContactSearchQuery('buyers looking for 3 bhks in HSR')
    ).toMatchObject({
      bhkMin: 3,
      budgetMax: null,
    });
    expect(
      parseContactSearchQuery('buyers looking for 3 bedroom flats in HSR')
    ).toMatchObject({
      bhkMin: 3,
      budgetMax: null,
      propertyTypes: ['Flat/ Apartment'],
    });
    expect(
      parseContactSearchQuery(
        'contacts looking for 1200 sqft office in Koramangala'
      )
    ).toMatchObject({
      budgetMax: null,
      propertyTypes: ['Commercial Office Space'],
    });
    expect(
      parseContactSearchQuery(
        'buyers in HSR who enquired between 2023 and 2024'
      )
    ).toMatchObject({
      budgetMin: null,
      budgetMax: null,
    });
  });

  it('reads a bare rent figure as thousands per month and a unit amount without a keyword', () => {
    expect(
      parseContactSearchQuery('tenants looking for rent under 40 in HSR')
        .budgetMax
    ).toBe(40_000);
    expect(
      parseContactSearchQuery('buyers in Whitefield 80 lakhs')
    ).toMatchObject({
      areas: ['Whitefield'],
      budgetMax: 8_000_000,
    });
    expect(
      parseContactSearchQuery('buyers in Whitefield 1.5 cr budget')
    ).toMatchObject({
      areas: ['Whitefield'],
      budgetMax: 15_000_000,
    });
  });

  it('normalises dotted or spaced initials and keeps every named area', () => {
    expect(parseContactSearchQuery('buyers in J.P. Nagar').areaProbes).toEqual([
      ['jp'],
    ]);
    expect(parseContactSearchQuery('buyers in J P Nagar').areaProbes).toEqual([
      ['jp'],
    ]);
    expect(
      parseContactSearchQuery('buyers looking in JP Nagar or Jayanagar').areas
    ).toEqual(['JP Nagar', 'Jayanagar']);
  });

  it('does not take a lead source after "from" as the locality', () => {
    expect(
      parseContactSearchQuery(
        'NRI clients from Dubai looking for villas in Whitefield'
      ).areas
    ).toEqual(['Whitefield']);
    expect(
      parseContactSearchQuery('leads from MagicBricks looking for 3 BHK in HSR')
        .areas
    ).toEqual(['HSR']);
  });

  it('[CPL-003] never lets a regex metacharacter reach the database as a probe', () => {
    expect(parseContactSearchQuery('contacts in |').areaProbes).toEqual([]);
    expect(parseContactSearchQuery('contacts in (').areaProbes).toEqual([]);
    expect(
      contactSearchFromPreferences({
        ...EMPTY_PREFERENCES,
        property_types: ['flat (apartment)'],
        areas: ['HSR [east]'],
      })
    ).toMatchObject({
      typeProbes: ['flat apartment'],
      areaProbes: [['hsr', 'east']],
    });
  });
});

describe('contactSearchFromPreferences', () => {
  it('maps an AI extraction onto the same query shape', () => {
    const query = contactSearchFromPreferences({
      ...EMPTY_PREFERENCES,
      areas: ['Jayanagar'],
      property_categories: ['residential'],
      property_types: ['Villa'],
      bhk_min: 4,
      bhk_max: 4,
      budget_max: 50_000_000,
      listing_types: ['Sale'],
    });
    expect(query.areas).toEqual(['Jayanagar']);
    expect(query.areaProbes).toEqual([['jaya']]);
    expect(query.typeProbes).toContain('villa');
    expect(query.bhkMin).toBe(4);
    expect(query.budgetMax).toBe(50_000_000);
    expect(query.listingTypes).toEqual(['Sale']);
  });
});

describe('buildContactSearchAnswer', () => {
  const query = parseContactSearchQuery(
    'Contact who is looking for residential property in JP Nagar under 2 cr'
  );

  it('describes the criteria in plain words', () => {
    expect(describeContactSearch(query)).toBe(
      'residential in JP Nagar under ₹2 Cr'
    );
    expect(contactListFilterParams(query)).toEqual({
      search: 'residential in JP Nagar under 2 cr',
      budget_max: '20000000',
    });
    expect(contactSearchListUrl(query)).toBe(
      '/contacts?search=residential%20in%20JP%20Nagar%20under%202%20cr&budget_max=20000000'
    );
    expect(
      contactListFilterParams(
        parseContactSearchQuery(
          'tenants looking to rent a 2 or 3 bhk villa in Whitefield or Jayanagar between 80 lakh and 1.2 cr'
        )
      )
    ).toEqual({
      search: '2 bhk villa in Whitefield 80 lakh to 1.2 cr',
      budget_min: '8000000',
      budget_max: '12000000',
    });
    expect(
      contactSearchListUrl(
        parseContactSearchQuery('which contacts are looking?')
      )
    ).toBe('/contacts');
  });

  it('[CPL-003] returns one contact-card link per match and a see-all link', () => {
    const answer = buildContactSearchAnswer(query, {
      total: 12,
      matches: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          label: 'Praveen',
          classification: 'Buyer',
          budgetMin: 20_000_000,
          budgetMax: 50_000_000,
          matchedArea: 'JP Nagar',
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          label: 'Asha Rao',
          classification: null,
          budgetMin: null,
          budgetMax: null,
          matchedArea: 'JP Nagar 7th Phase',
        },
      ],
    });
    expect(answer.reply).toContain('12 contacts are looking for');
    expect(answer.reply).toContain('Top 2');
    expect(answer.reply).not.toMatch(/\+?\d{10}/);
    expect(answer.links).toEqual([
      {
        label: 'Praveen',
        subtitle: 'Buyer · ₹2 Cr–₹5 Cr · JP Nagar',
        navigateTo: '/contacts?contactId=11111111-1111-4111-8111-111111111111',
      },
      {
        label: 'Asha Rao',
        subtitle: 'JP Nagar 7th Phase',
        navigateTo: '/contacts?contactId=22222222-2222-4222-8222-222222222222',
      },
      {
        label: 'See all 12 in Contacts',
        navigateTo:
          '/contacts?search=residential%20in%20JP%20Nagar%20under%202%20cr&budget_max=20000000',
      },
    ]);
  });

  it('[CPL-003] still links to the Contacts list when every match is shown', () => {
    const answer = buildContactSearchAnswer(query, {
      total: 1,
      matches: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          label: 'Praveen',
          classification: 'Buyer',
          budgetMin: null,
          budgetMax: null,
          matchedArea: 'JP Nagar',
        },
      ],
    });
    expect(answer.links.map((link) => link.label)).toEqual([
      'Praveen',
      'Open in Contacts',
    ]);
    expect(answer.links[1].navigateTo).toBe(
      '/contacts?search=residential%20in%20JP%20Nagar%20under%202%20cr&budget_max=20000000'
    );
  });

  it('[CPL-003] answers an empty result with a next step instead of a tour', () => {
    const answer = buildContactSearchAnswer(query, { total: 0, matches: [] });
    expect(answer.reply).toMatch(/^No contacts are looking for residential/);
    expect(answer.links).toEqual([
      {
        label: 'Open Contacts',
        navigateTo:
          '/contacts?search=residential%20in%20JP%20Nagar%20under%202%20cr&budget_max=20000000',
      },
    ]);
  });
});
