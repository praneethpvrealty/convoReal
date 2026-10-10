import { describe, expect, it } from 'vitest';
import {
  buildPropertyInterestAnswer,
  interestReasonLabel,
  isPropertyInterestQuestion,
  parsePropertyInterestQuestion,
  readInterestWindow,
  type PropertyInterestMatch,
  type PropertyInterestQuery,
} from './property-interest';
import { isContactSearchQuestion } from './contact-search';

const NOW = new Date('2026-10-10T06:00:00Z');
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
const CONTACT_ID = '11111111-1111-4111-8111-111111111111';

function query(
  overrides: Partial<PropertyInterestQuery> = {}
): PropertyInterestQuery {
  return {
    direction: 'contacts',
    propertyIds: [],
    ownerContactIds: [],
    ownerName: 'Adithi',
    propertyProbe: null,
    contactIds: [],
    contactName: null,
    signal: 'any',
    since: null,
    sinceLabel: null,
    across: false,
    ...overrides,
  };
}

function match(
  overrides: Partial<PropertyInterestMatch> = {}
): PropertyInterestMatch {
  return {
    propertyId: PROPERTY_ID,
    propertyTitle: 'Prime Corner Commercial Plot for Sale',
    propertyCode: 'PROP-1023',
    contactId: CONTACT_ID,
    label: 'Ramesh',
    classification: 'Buyer',
    enquired: true,
    viewsCount: 2,
    shortlisted: false,
    visited: false,
    liked: false,
    journeyStage: null,
    journeyStatus: null,
    lastAt: '2026-10-08T10:00:00Z',
    ...overrides,
  };
}

describe('parsePropertyInterestQuestion', () => {
  it.each([
    [
      "List out all the buyers who had showed interest in Adithi's property",
      'Adithi',
    ],
    [
      'List out all the buyers who had showed interest in property where Adithi is the owner',
      'Adithi',
    ],
    ["who enquired about adithi's listing", 'adithi'],
    ['buyers interested in the property owned by Adithi', 'Adithi'],
    ['who all are interested in the listing of owner Adithi Rao', 'Adithi Rao'],
    ['Adithi is the owner, who enquired about her property', 'Adithi'],
    ["list buyers for Adithi's property", 'Adithi'],
    ['kaun kaun ne Adithi ki property dekha', 'Adithi'],
  ])('[CPL-004] reads the owner out of "%s"', (message, owner) => {
    const parsed = parsePropertyInterestQuestion(message, [], NOW);
    expect(parsed?.direction).toBe('contacts');
    expect(parsed?.ownerName).toBe(owner);
    expect(parsed?.propertyProbe).toBeNull();
  });

  it.each([
    ['who showed interest in PROP-1023', 'PROP-1023'],
    [
      'who enquired about the Banashankari commercial plot',
      'Banashankari commercial plot',
    ],
    [
      'which contacts shortlisted the property called Prime Corner',
      'Prime Corner',
    ],
    [
      'who visited "Prime Corner Commercial Plot"',
      'Prime Corner Commercial Plot',
    ],
  ])('[CPL-004] reads a listing probe out of "%s"', (message, probe) => {
    const parsed = parsePropertyInterestQuestion(message, [], NOW);
    expect(parsed?.direction).toBe('contacts');
    expect(parsed?.propertyProbe).toBe(probe);
    expect(parsed?.ownerName).toBeNull();
  });

  it.each([
    'view #Prime Corner',
    'open #Prime Corner',
    'show #Prime Corner enquiries',
  ])('[CPL-004] leaves "%s" to entity navigation', (message) => {
    expect(
      parsePropertyInterestQuestion(
        message,
        [{ kind: 'property', id: PROPERTY_ID, label: 'Prime Corner' }],
        NOW
      )
    ).toBeNull();
  });

  it('[CPL-004] prefers a selected # property over any name in the text', () => {
    const parsed = parsePropertyInterestQuestion(
      "who enquired about #Prime Corner, Adithi's property",
      [{ kind: 'property', id: PROPERTY_ID, label: 'Prime Corner' }],
      NOW
    );
    expect(parsed?.propertyIds).toEqual([PROPERTY_ID]);
    expect(parsed?.ownerName).toBeNull();
  });

  it('[CPL-004] reads a selected @ contact as the owner when the question is about their property', () => {
    const parsed = parsePropertyInterestQuestion(
      "who showed interest in @Adithi's property",
      [{ kind: 'contact', id: CONTACT_ID, label: 'Adithi' }],
      NOW
    );
    expect(parsed?.direction).toBe('contacts');
    expect(parsed?.ownerContactIds).toEqual([CONTACT_ID]);
  });

  it.each([
    ['what properties did Ramesh enquire about', 'Ramesh', 'enquired'],
    [
      'which listings has Ramesh Kumar viewed this month',
      'Ramesh Kumar',
      'viewed',
    ],
    ["Ramesh's enquiries", 'Ramesh', 'enquired'],
    ['properties that Ramesh is interested in', 'Ramesh', 'any'],
  ])(
    '[CPL-004] turns "%s" around to the listings one contact engaged with',
    (message, name, signal) => {
      const parsed = parsePropertyInterestQuestion(message, [], NOW);
      expect(parsed?.direction).toBe('properties');
      expect(parsed?.contactName).toBe(name);
      expect(parsed?.signal).toBe(signal);
    }
  );

  it('[CPL-004] reads a selected @ contact as the subject of "which properties did they view"', () => {
    const parsed = parsePropertyInterestQuestion(
      'which properties did @Ramesh view',
      [{ kind: 'contact', id: CONTACT_ID, label: 'Ramesh' }],
      NOW
    );
    expect(parsed?.direction).toBe('properties');
    expect(parsed?.contactIds).toEqual([CONTACT_ID]);
    expect(parsed?.contactName).toBeNull();
    expect(parsed?.signal).toBe('viewed');
  });

  it.each([
    [
      "Which buyers viewed Adithi's plot in the last 7 days?",
      'viewed',
      'in the last 7 days',
    ],
    ["who enquired about adithi's listing this week", 'enquired', 'this week'],
    ["which contacts shortlisted Adithi's property", 'shortlisted', null],
    ["who had a site visit for Adithi's property", 'visited', null],
    ["who liked Adithi's listing", 'liked', null],
  ])(
    '[CPL-004] reads the signal and window out of "%s"',
    (message, signal, sinceLabel) => {
      const parsed = parsePropertyInterestQuestion(message, [], NOW);
      expect(parsed?.signal).toBe(signal);
      expect(parsed?.sinceLabel).toBe(sinceLabel);
      expect(parsed?.since == null).toBe(sinceLabel == null);
    }
  );

  it.each([
    'who enquired today',
    "today's enquiries",
    'which buyers viewed listings this week',
  ])('[CPL-004] reads "%s" as every listing inside the window', (message) => {
    const parsed = parsePropertyInterestQuestion(message, [], NOW);
    expect(parsed?.direction).toBe('contacts');
    expect(parsed?.across).toBe(true);
    expect(parsed?.since).toBeTruthy();
  });

  it.each([
    'which buyers are interested in my listing',
    'who viewed this property',
  ])('[CPL-004] asks for the listing when "%s" names none', (message) => {
    const parsed = parsePropertyInterestQuestion(message, [], NOW);
    expect(parsed?.across).toBe(false);
    expect(parsed?.ownerName).toBeNull();
    expect(parsed?.propertyProbe).toBeNull();
    const { reply, links } = buildPropertyInterestAnswer(parsed!, {
      properties: [],
      contacts: [],
      matches: [],
      total: 0,
    });
    expect(reply).toContain('pick it with #');
    expect(links).toEqual([
      { label: 'Open Inventory', navigateTo: '/inventory' },
    ]);
  });

  it.each([
    'buyers interested in JP Nagar',
    'contacts looking for 3 bhk in HSR Layout under 2 cr',
    'show me leads interested in plots near Sarjapur',
    'Share me contacts who are interested in residential plots in JP Nagar',
    'Contact who is looking for residential property in JP Nagar',
    'share the property with contacts who enquired',
    "send the brochure to buyers who enquired about Adithi's property",
    'how do I see who viewed my property',
    'Why are my leads not showing up in the inbox?',
    'Who is the owner of PROP-12',
    'open @Praveen',
    'What is a lead temperature?',
  ])('[CPL-004] leaves "%s" to the other intents', (message) => {
    expect(isPropertyInterestQuestion(message)).toBe(false);
  });

  it('[CPL-004] still runs the reported question ahead of the preference search it used to fall into', () => {
    const message =
      "List out all the buyers who had showed interest in Adithi's property";
    expect(isPropertyInterestQuestion(message)).toBe(true);
    expect(isContactSearchQuestion(message)).toBe(true);
  });
});

describe('readInterestWindow', () => {
  it('[CPL-004] starts "today" at IST midnight', () => {
    expect(readInterestWindow('who enquired today', NOW)).toEqual({
      since: '2026-10-09T18:30:00.000Z',
      sinceLabel: 'today',
    });
    expect(readInterestWindow('last 3 days', NOW).since).toBe(
      '2026-10-06T18:30:00.000Z'
    );
    expect(readInterestWindow('who viewed in the last 24 hours', NOW)).toEqual({
      since: '2026-10-09T06:00:00.000Z',
      sinceLabel: 'in the last 24 hours',
    });
    expect(readInterestWindow('who enquired', NOW)).toEqual({
      since: null,
      sinceLabel: null,
    });
  });
});

describe('buildPropertyInterestAnswer', () => {
  const property = {
    id: PROPERTY_ID,
    title: 'Prime Corner Commercial Plot for Sale',
    code: 'PROP-1023',
    ownerName: 'Adithi',
  };

  it('[CPL-004] lists who showed interest with contact-card links and the listing, never a phone number', () => {
    const { reply, links } = buildPropertyInterestAnswer(query(), {
      properties: [property],
      contacts: [],
      matches: [
        match(),
        match({
          contactId: '33333333-3333-4333-8333-333333333333',
          label: 'Suresh',
          classification: null,
          enquired: false,
          viewsCount: 1,
          journeyStage: 'Shortlist',
          journeyStatus: 'dropped',
          lastAt: '2026-10-07T10:00:00Z',
        }),
      ],
      total: 2,
    });
    expect(reply).toBe(
      [
        "2 contacts showed interest in Prime Corner Commercial Plot for Sale (Adithi's listing):",
        '• Ramesh — Buyer · Enquired · 2 views · 8 Oct',
        '• Suresh — Viewed · Dropped after Shortlist · 7 Oct',
        '',
        'Tap a name to open the contact.',
      ].join('\n')
    );
    expect(links).toEqual([
      {
        label: 'Ramesh',
        subtitle: 'Buyer · Enquired · 2 views',
        navigateTo: `/contacts?contactId=${CONTACT_ID}`,
      },
      {
        label: 'Suresh',
        subtitle: 'Viewed · Dropped after Shortlist',
        navigateTo: '/contacts?contactId=33333333-3333-4333-8333-333333333333',
      },
      {
        label: 'Open Prime Corner Commercial Plot for Sale',
        subtitle: 'PROP-1023',
        navigateTo: `/inventory?propertyId=${PROPERTY_ID}`,
      },
    ]);
    expect(JSON.stringify({ reply, links })).not.toMatch(/phone|\+91/i);
  });

  it('[CPL-004] points at the listing audience when more engaged than it can show', () => {
    const { reply, links } = buildPropertyInterestAnswer(
      query({
        signal: 'enquired',
        sinceLabel: 'this week',
        since: NOW.toISOString(),
      }),
      { properties: [property], contacts: [], matches: [match()], total: 9 }
    );
    expect(reply.split('\n')[0]).toBe(
      "9 contacts enquired about Prime Corner Commercial Plot for Sale (Adithi's listing) this week. Latest 1:"
    );
    expect(links[1]).toEqual({
      label: 'Listing audience',
      subtitle: 'Everyone who enquired or viewed',
      navigateTo: `/inventory?sharePropertyId=${PROPERTY_ID}&shareAudience=1`,
    });
  });

  it('[CPL-004] says when a found listing has no interest yet, and when no listing was found', () => {
    const none = buildPropertyInterestAnswer(query(), {
      properties: [property],
      contacts: [],
      matches: [],
      total: 0,
    });
    expect(none.reply).toBe(
      "No contact has enquired about, viewed, shortlisted or visited Prime Corner Commercial Plot for Sale (Adithi's listing) yet."
    );
    expect(none.links).toEqual([
      {
        label: 'Open Prime Corner Commercial Plot for Sale',
        subtitle: 'PROP-1023',
        navigateTo: `/inventory?propertyId=${PROPERTY_ID}`,
      },
    ]);

    const missing = buildPropertyInterestAnswer(query({ ownerName: 'Zara' }), {
      properties: [],
      contacts: [],
      matches: [],
      total: 0,
    });
    expect(missing.reply).toContain("I couldn't find a listing owned by Zara");
    expect(missing.links).toEqual([
      { label: 'Open Inventory', navigateTo: '/inventory' },
    ]);
  });

  it('[CPL-004] names the listing on each line when an owner has several', () => {
    const second = {
      ...property,
      id: '44444444-4444-4444-8444-444444444444',
      code: 'PROP-1050',
      title: 'Lake View Villa',
    };
    const { reply } = buildPropertyInterestAnswer(query(), {
      properties: [property, second],
      contacts: [],
      matches: [
        match(),
        match({
          propertyId: second.id,
          propertyCode: 'PROP-1050',
          propertyTitle: 'Lake View Villa',
          label: 'Suresh',
        }),
      ],
      total: 2,
    });
    expect(reply).toContain(
      "2 contacts showed interest in Adithi's 2 listings:"
    );
    expect(reply).toContain(
      '• Suresh — Buyer · Enquired · 2 views · PROP-1050 · 8 Oct'
    );
  });

  it('[CPL-004] answers the reverse question with listing links and the contact', () => {
    const { reply, links } = buildPropertyInterestAnswer(
      query({
        direction: 'properties',
        ownerName: null,
        contactName: 'Ramesh',
        signal: 'enquired',
      }),
      {
        properties: [],
        contacts: [
          { id: CONTACT_ID, label: 'Ramesh', classification: 'Buyer' },
        ],
        matches: [match()],
        total: 1,
      }
    );
    expect(reply).toBe(
      [
        'Ramesh enquired about 1 listing:',
        '• Prime Corner Commercial Plot for Sale — PROP-1023 · Enquired · 2 views · 8 Oct',
        '',
        'Tap a listing to open it.',
      ].join('\n')
    );
    expect(links).toEqual([
      {
        label: 'Prime Corner Commercial Plot for Sale',
        subtitle: 'PROP-1023 · Enquired · 2 views',
        navigateTo: `/inventory?propertyId=${PROPERTY_ID}`,
      },
      {
        label: 'Open Ramesh',
        subtitle: 'Buyer',
        navigateTo: `/contacts?contactId=${CONTACT_ID}`,
      },
    ]);
  });

  it('[CPL-004] describes every signal a contact left on a listing', () => {
    expect(
      interestReasonLabel(
        match({
          shortlisted: true,
          visited: true,
          liked: true,
          journeyStage: 'Site visit',
          journeyStatus: 'active',
        })
      )
    ).toBe(
      'Enquired · 2 views · Shortlisted · Site visit · Liked · At Site visit'
    );
  });
});
