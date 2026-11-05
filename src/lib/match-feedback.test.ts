import { describe, expect, it } from 'vitest';

import {
  MATCH_REJECT_REASONS,
  PROPERTY_TYPE_OPTIONS,
  STAFF_PROPERTY_TYPE_OPTIONS,
  bandReasonDirection,
  isMatchRejectReason,
  sharesAreaReason,
  sharesBandReason,
  notAFitSavedMessage,
  propertyTypeAnswerGroups,
  sharesTypeAnswer,
  partitionMatchesByFeedback,
  propertyTypeNote,
  propertyTypePatch,
  suggestPropertyTypeOption,
  type MatchFeedbackMark,
} from '@/lib/match-feedback';
import { getMatchingContacts, resolvePropertyGroup } from '@/lib/matching';
import type { Contact, Property } from '@/types';

const building: Partial<Property> = {
  id: 'p1',
  title: 'Commercial Building with 18000 Sq.Ft. Built-up Area',
  type: 'Commercial Building',
  listing_type: 'Sale',
  price: 150_000_000,
  sublocality: 'Banashankari',
  city: 'Bengaluru',
};

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    user_id: 'u1',
    phone: '919900000000',
    name: 'Ashwini',
    classification: 'Buyer',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    pref_areas: ['Banashankari'],
    pref_extracted_at: '2026-10-01T00:00:00Z',
    ...overrides,
  } as Contact;
}

function mark(contactId: string, over: Partial<MatchFeedbackMark> = {}) {
  return {
    contactId,
    reason: 'type',
    source: 'agent',
    createdAt: '2026-10-24T00:00:00Z',
    ...over,
  } as MatchFeedbackMark;
}

describe('[PRP-051] "Not a fit" teaches the matcher', () => {
  it('a type answer stops a type-less contact matching the wrong kind of listing', () => {
    const before = contact();
    expect(getMatchingContacts(building, [before])).toHaveLength(1);
    expect(getMatchingContacts(building, [before])[0].details.type).toBe(
      'unknown'
    );

    const after = contact({ ...propertyTypePatch(['pt_plot'])! });
    expect(getMatchingContacts(building, [after])).toHaveLength(0);
    expect(
      getMatchingContacts(
        { ...building, type: 'Residential Land/ Plot', title: 'Site' },
        [after]
      )
    ).toHaveLength(1);
  });

  it('replaces a legacy interest that would keep the ruled-out listing', () => {
    const legacy = contact({ property_interests: ['Commercial Building'] });
    expect(getMatchingContacts(building, [legacy])).toHaveLength(1);
    const fixed = contact({
      ...legacy,
      ...propertyTypePatch(['pt_agri'])!,
    });
    expect(fixed.property_interests).toEqual([]);
    expect(getMatchingContacts(building, [fixed])).toHaveLength(0);
  });

  it('writes the matcher vocabulary and a note that survives re-extraction', () => {
    expect(propertyTypePatch(['pt_house', 'pt_land'])).toEqual({
      pref_property_types: [
        'Residential House',
        'Villa',
        'Residential Land/ Plot',
        'Commercial Plot',
        'Agricultural Land',
      ],
      pref_property_categories: [],
      property_interests: [],
    });
    expect(propertyTypePatch(['nope'])).toBeNull();
    expect(propertyTypeNote(['pt_plot', 'pt_agri'])).toBe(
      'Looking for Residential Plot or Agricultural Land only (set by agent from a "Not a fit" mark).'
    );
  });

  it('keeps every kind of land when Any land is picked beside a building type', () => {
    const contactFor = (ids: string[]) =>
      contact({ pref_areas: [], ...propertyTypePatch(ids)! });
    const listing = (type: string) => ({
      ...building,
      type,
      title: type,
    });
    for (const type of [
      'Residential Land/ Plot',
      'Commercial Plot',
      'Agricultural Land',
      'Villa',
    ]) {
      expect(
        getMatchingContacts(listing(type), [
          contactFor(['pt_house', 'pt_land']),
        ])
      ).toHaveLength(1);
    }
    expect(
      getMatchingContacts(building, [contactFor(['pt_house', 'pt_land'])])
    ).toHaveLength(0);
  });

  it('every type option resolves to the groups it claims', () => {
    for (const option of PROPERTY_TYPE_OPTIONS) {
      for (const type of option.types) {
        expect(option.groups).toContain(
          resolvePropertyGroup({ type, title: '' })
        );
      }
    }
    expect(STAFF_PROPERTY_TYPE_OPTIONS.map((o) => o.id)).not.toContain(
      'pt_commland'
    );
  });

  it('hides every rejected contact, whoever said no, with the mark', () => {
    const rows = [
      { contact: { id: 'a' } },
      { contact: { id: 'b' } },
      { contact: { id: 'c' } },
    ];
    const contacts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const { visible, hidden } = partitionMatchesByFeedback(
      rows,
      [
        mark('b', { createdAt: '2026-10-23T00:00:00Z' }),
        mark('c', { source: 'contact', reason: 'budget' }),
      ],
      contacts
    );
    expect(visible.map((r) => r.contact.id)).toEqual(['a']);
    expect(hidden.map((r) => [r.contact.id, r.feedback.source])).toEqual([
      ['c', 'contact'],
      ['b', 'agent'],
    ]);
  });

  it('keeps a contact restorable after their corrected type stops them ranking', () => {
    const corrected = contact({ ...propertyTypePatch(['pt_plot'])! });
    const ranked = getMatchingContacts(building, [corrected]);
    expect(ranked).toHaveLength(0);
    const { visible, hidden } = partitionMatchesByFeedback(
      ranked,
      [mark(corrected.id)],
      [corrected]
    );
    expect(visible).toHaveLength(0);
    expect(hidden.map((r) => r.contact.id)).toEqual([corrected.id]);
  });

  it('accepts only the reasons the table allows', () => {
    expect(MATCH_REJECT_REASONS.map((r) => r.reason)).toEqual([
      'type',
      'budget',
      'location',
      'size',
      'bought_elsewhere',
      'not_now',
      'other',
    ]);
    expect(isMatchRejectReason('type')).toBe(true);
    expect(isMatchRejectReason('price')).toBe(false);
  });
});

describe('[PRP-051] type suggestions', () => {
  it('suggests nothing before a contact is ruled out for type', () => {
    expect(
      suggestPropertyTypeOption({
        rejectedGroups: [],
        interestedGroups: ['apartment', 'apartment'],
      })
    ).toBeNull();
  });

  it('names the type the contact keeps asking about', () => {
    expect(
      suggestPropertyTypeOption({
        rejectedGroups: ['commercial-space'],
        interestedGroups: ['residential-plot', 'residential-plot', 'house'],
      })?.id
    ).toBe('pt_plot');
  });

  it('ignores interest in the very type that was rejected', () => {
    expect(
      suggestPropertyTypeOption({
        rejectedGroups: ['commercial-space'],
        interestedGroups: ['commercial-space'],
      })
    ).toBeNull();
  });

  it('reads two building rejections and no interest as a site seeker', () => {
    expect(
      suggestPropertyTypeOption({
        rejectedGroups: ['commercial-space', 'apartment'],
        interestedGroups: [],
      })?.id
    ).toBe('pt_land');
    expect(
      suggestPropertyTypeOption({
        rejectedGroups: ['commercial-space'],
        interestedGroups: [],
      })
    ).toBeNull();
    expect(
      suggestPropertyTypeOption({
        rejectedGroups: ['agricultural', 'apartment'],
        interestedGroups: [],
      })
    ).toBeNull();
  });
});

describe('[PRP-051] the same type answer hides the same seekers', () => {
  it('a seeker matches the answer only when every type they state is in it', () => {
    const flat = {
      groups: propertyTypeAnswerGroups(['pt_apartment']),
      categories: ['residential'],
    };
    const wants = (groups: string[], categories: string[] = []) => ({
      groups,
      categories,
    });
    expect(sharesTypeAnswer(wants(['apartment']), flat)).toBe(true);
    expect(sharesTypeAnswer(wants(['apartment'], ['residential']), flat)).toBe(
      true
    );
    expect(sharesTypeAnswer(wants(['apartment'], ['commercial']), flat)).toBe(
      false
    );
    expect(sharesTypeAnswer(wants(['apartment', 'house']), flat)).toBe(false);
    expect(sharesTypeAnswer(wants([]), flat)).toBe(false);
    expect(sharesTypeAnswer(null, flat)).toBe(false);
    expect(
      sharesTypeAnswer(wants(['apartment']), { groups: [], categories: [] })
    ).toBe(false);
  });

  it('the confirmation names how many others were hidden', () => {
    expect(
      notAFitSavedMessage('LAKSHMAN', { typeSaved: true, alsoHidden: 0 }, [
        'pt_apartment',
      ])
    ).toBe(
      'LAKSHMAN is hidden here, and their property type is saved for future matches.'
    );
    expect(
      notAFitSavedMessage('LAKSHMAN', { typeSaved: true, alsoHidden: 4 }, [
        'pt_apartment',
      ])
    ).toBe(
      'LAKSHMAN is hidden here, and their property type is saved for future matches. 4 other contacts looking for Flat / Apartment were hidden too.'
    );
    expect(
      notAFitSavedMessage('Omi', { typeSaved: false, alsoHidden: 1 }, [])
    ).toBe(
      "Omi is hidden from this listing's matches. 1 other contact with the same type was hidden too."
    );
  });
});

describe('[PRP-051] location and budget marks hide the matches they hold for', () => {
  it('a location mark holds for a contact naming only the same areas and projects', () => {
    const marked = { areas: ['sarjapur road', 'hsr layout'], projects: [] };
    const wants = (areas: string[], projects: string[] = []) => ({
      areas,
      projects,
    });
    expect(sharesAreaReason(wants(['sarjapur road']), marked)).toBe(true);
    expect(
      sharesAreaReason(wants(['sarjapur road', 'whitefield']), marked)
    ).toBe(false);
    expect(
      sharesAreaReason(wants(['sarjapur road'], ['sjr blue waters']), marked)
    ).toBe(false);
    expect(sharesAreaReason(wants([]), marked)).toBe(false);
    expect(sharesAreaReason(null, marked)).toBe(false);
    expect(sharesAreaReason(wants(['sarjapur road']), null)).toBe(false);
  });

  it('a budget mark reads which side of the band the listing misses', () => {
    expect(bandReasonDirection({ min: null, max: 8e7 }, 9e7)).toBe('over');
    expect(bandReasonDirection({ min: 6e7, max: 1e8 }, 9e7)).toBe('over');
    expect(bandReasonDirection({ min: 6e7, max: 1e8 }, 7e7)).toBe('under');
    expect(bandReasonDirection({ min: 1e8, max: null }, 9e7)).toBe('under');
    expect(bandReasonDirection({ min: null, max: 1e8 }, 5e7)).toBe(null);
    expect(bandReasonDirection({ min: 5e7, max: null }, 9e7)).toBe(null);
    expect(bandReasonDirection({ min: 6e7, max: 1e8 }, 1.1e8)).toBe('over');
    expect(bandReasonDirection({ min: 6e7, max: 1e8 }, 5e7)).toBe('under');
    expect(bandReasonDirection({ min: null, max: null }, 9e7)).toBe(null);
    expect(bandReasonDirection(null, 9e7)).toBe(null);
    expect(bandReasonDirection({ min: null, max: 8e7 }, 0)).toBe(null);
    expect(bandReasonDirection({ min: null, max: 8e7 }, null)).toBe(null);
  });

  it('a budget mark holds for a contact whose budget stops on the same side', () => {
    const marked = { min: null, max: 8e7 };
    expect(sharesBandReason({ min: null, max: 7.5e7 }, marked, 9e7)).toBe(true);
    expect(sharesBandReason({ min: null, max: 8e7 }, marked, 9e7)).toBe(true);
    expect(sharesBandReason({ min: null, max: 1.2e8 }, marked, 9e7)).toBe(
      false
    );
    expect(sharesBandReason({ min: null, max: null }, marked, 9e7)).toBe(false);
    expect(sharesBandReason(null, marked, 9e7)).toBe(false);
    const floor = { min: 1e8, max: null };
    expect(sharesBandReason({ min: 1.1e8, max: null }, floor, 9e7)).toBe(true);
    expect(sharesBandReason({ min: 9e7, max: null }, floor, 9e7)).toBe(false);
  });

  it('the confirmation names the reason the others share', () => {
    const result = { typeSaved: false, alsoHidden: 3 };
    expect(notAFitSavedMessage('LAKSHMAN', result, [], 'location')).toBe(
      "LAKSHMAN is hidden from this listing's matches. 3 other contacts looking in the same areas were hidden too."
    );
    expect(
      notAFitSavedMessage(
        'LAKSHMAN',
        { ...result, alsoHidden: 1 },
        [],
        'bought_elsewhere'
      )
    ).toBe(
      "LAKSHMAN is hidden from this listing's matches. 1 other contact buying with them was hidden too."
    );
    expect(notAFitSavedMessage('LAKSHMAN', result, [], 'size')).toBe(
      "LAKSHMAN is hidden from this listing's matches. 3 other contacts looking for the same size were hidden too."
    );
    expect(notAFitSavedMessage('LAKSHMAN', result, [], 'budget')).toBe(
      "LAKSHMAN is hidden from this listing's matches. 3 other contacts with the same budget were hidden too."
    );
  });
});
