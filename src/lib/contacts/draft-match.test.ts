import { describe, expect, it } from 'vitest';
import {
  enrichmentFor,
  matchContactByExactName,
  matchContactByName,
  matchContactByPhone,
  sameDraftSubject,
  suggestPhoneLink,
  phoneLinkButtonTitle,
  type BookContact,
} from './draft-match';

const c = (id: string, name: string | null, phone: string | null = null): BookContact => ({
  id,
  name,
  phone,
});

describe('matchContactByName', () => {
  const book = [
    c('vas', 'Vasundhara', '+919972225992'),
    c('durga', 'Durga Prasad (Debi Prasad) Purva Atmosphere Seller', '+918422948781'),
  ];

  it('finds the contact a forwarded chat title is about', () => {
    // The reported case. The phonebook name carries the project and a
    // status word; the Engine row is just the person.
    expect(matchContactByName('Vasundhara Purva Atmosphere', book)?.id).toBe('vas');
  });

  it('matches in the other direction too', () => {
    // The book can be the longer one — an agent who typed the full
    // name once and a chat header that shows only the first.
    expect(matchContactByName('Durga Prasad', book)?.id).toBe('durga');
  });

  it('is null when two people share the prefix', () => {
    // Two Ravis means the draft named "Ravi" is about neither. Silence
    // is the honest answer; a guess writes a budget onto a stranger.
    const ravis = [c('a', 'Ravi Kumar'), c('b', 'Ravi Shankar')];
    expect(matchContactByName('Ravi', ravis)).toBeNull();
  });

  it('does not match on a bare initial', () => {
    expect(matchContactByName('S Praneeth Kumar', [c('x', 'S')])).toBeNull();
  });

  it('is null for an unrelated name, an empty book, or no name', () => {
    expect(matchContactByName('Gopi Krishnan', book)).toBeNull();
    expect(matchContactByName('Vasundhara', [])).toBeNull();
    expect(matchContactByName(null, book)).toBeNull();
    expect(matchContactByName('   ', book)).toBeNull();
  });

  it('ignores case, punctuation and bracketed annotations', () => {
    expect(matchContactByName('vasundhara (purva)', book)?.id).toBe('vas');
  });
});

describe('matchContactByExactName', () => {
  it('finds one exact full-name contact', () => {
    expect(
      matchContactByExactName('Sandeep Kotecha', [
        c('sandeep', 'Sandeep Kotecha', '+919900001111'),
        c('other', 'Sandeep Kumar', '+919900002222'),
      ])?.id
    ).toBe('sandeep');
  });

  it('does not guess for a prefix or duplicate exact names', () => {
    expect(matchContactByExactName('Sandeep', [c('s', 'Sandeep Kotecha')])).toBeNull();
    expect(
      matchContactByExactName('Sandeep Kotecha', [
        c('a', 'Sandeep Kotecha'),
        c('b', 'Sandeep Kotecha'),
      ])
    ).toBeNull();
  });
});

describe('matchContactByPhone', () => {
  const book = [c('vas', 'Vasundhara', '+919972225992')];

  it('matches however the number was written', () => {
    // The same person saved from a webhook and by hand is +91… against
    // the bare 10 digits.
    for (const p of ['+919972225992', '9972225992', '+91 99722 25992', '0919972225992']) {
      expect(matchContactByPhone(p, book)?.id, p).toBe('vas');
    }
  });

  it('is null for a different number or a fragment', () => {
    expect(matchContactByPhone('+919999999999', book)).toBeNull();
    expect(matchContactByPhone('2992', book)).toBeNull();
    expect(matchContactByPhone(null, book)).toBeNull();
  });
});

describe('enrichmentFor', () => {
  it('carries the requirements a forwarded chat established', () => {
    // The whole point: this used to be reported as a skipped duplicate
    // and the budget went in the bin.
    const out = enrichmentFor(
      { requirements: '4BHK or spacious 3BHK, North along the metro, around 4cr' },
      { requirements: '' }
    );
    expect(out.requirements).toContain('4cr');
    expect(out.changed).toContain('requirements');
  });

  it('appends rather than replacing what the contact already said', () => {
    const out = enrichmentFor(
      { requirements: 'Budget now 4cr' },
      { requirements: 'Wanted 3BHK in Hebbal' }
    );
    expect(out.requirements).toBe('Wanted 3BHK in Hebbal\nBudget now 4cr');
  });

  it('does not stack the same brief twice', () => {
    const out = enrichmentFor(
      { requirements: 'Wanted 3BHK in Hebbal' },
      { requirements: 'Wanted 3BHK in Hebbal' }
    );
    expect(out.requirements).toBeNull();
    expect(out.changed).toEqual([]);
  });

  it('fills a blank field but never overwrites one', () => {
    // An agent's own edit in the CRM outranks an extraction from a
    // screenshot.
    const out = enrichmentFor(
      { email: 'new@x.com', company: 'Acme' },
      { email: 'kept@x.com', company: null }
    );
    expect(out.updates).toEqual({ company: 'Acme' });
    expect(out.changed).toEqual(['company']);
  });

  it('folds notes into the brief alongside requirements', () => {
    const out = enrichmentFor(
      { requirements: 'Around 4cr', notes: 'Source: WhatsApp chat' },
      {}
    );
    expect(out.requirements).toBe('Around 4cr\nSource: WhatsApp chat');
  });

  it('reports nothing to do for an empty draft', () => {
    expect(enrichmentFor({}, { requirements: 'x' })).toEqual({
      updates: {},
      requirements: null,
      changed: [],
    });
  });
});

describe('sameDraftSubject', () => {
  it('is true for a second screenshot of the same person', () => {
    expect(
      sameDraftSubject({ name: 'Vasundhara', phone: null }, { name: 'Vasundhara Purva Atmosphere', phone: null })
    ).toBe(true);
  });

  it('lets two phone numbers settle it, whatever the names say', () => {
    // The failure positional merging could not see: same name, two
    // different people. A number on both sides is decisive.
    expect(
      sameDraftSubject({ name: 'Ravi Kumar', phone: '9845012345' }, { name: 'Ravi Kumar', phone: '9880011223' })
    ).toBe(false);
    expect(
      sameDraftSubject({ name: 'Ravi', phone: '+919845012345' }, { name: 'Someone Else', phone: '9845012345' })
    ).toBe(true);
  });

  it('falls back to the name only when a side has no number', () => {
    expect(
      sameDraftSubject({ name: 'Shiv Jayanagar', phone: null }, { name: 'Vasundhara', phone: '9845012345' })
    ).toBe(false);
  });

  it('is false when neither side carries anything to match on', () => {
    expect(sameDraftSubject({}, {})).toBe(false);
    expect(sameDraftSubject({ name: 'A' }, { name: 'A B' })).toBe(false);
  });
});

describe('suggestPhoneLink', () => {
  const book = [
    c('vas', 'Vasundhara', '+919972225992'),
    c('durga', 'Durga Prasad (Debi Prasad) Purva Atmosphere Seller', '+918422948781'),
  ];

  it('offers the contact a phoneless forwarded chat is about', () => {
    // The reported dead end: name from the chat header, no number, so
    // the draft could never be confirmed.
    const out = suggestPhoneLink([{ name: 'Vasundhara Purva Atmosphere', phone: null }], book);
    expect(out?.contact.id).toBe('vas');
    expect(out?.index).toBe(0);
  });

  it('says nothing when the draft already has a number', () => {
    expect(
      suggestPhoneLink([{ name: 'Vasundhara Purva Atmosphere', phone: '9972225992' }], book)
    ).toBeNull();
  });

  it('says nothing when the match is ambiguous', () => {
    const ravis = [c('a', 'Ravi Kumar', '9000000001'), c('b', 'Ravi Shankar', '9000000002')];
    expect(suggestPhoneLink([{ name: 'Ravi', phone: null }], ravis)).toBeNull();
  });

  it('skips a book row that has no number to lend', () => {
    expect(suggestPhoneLink([{ name: 'Gopi', phone: null }], [c('g', 'Gopi', null)])).toBeNull();
  });

  it('points at the first phoneless contact, not the first contact', () => {
    const out = suggestPhoneLink(
      [{ name: 'Someone', phone: '9000000009' }, { name: 'Vasundhara', phone: null }],
      book
    );
    expect(out?.index).toBe(1);
    expect(out?.contact.id).toBe('vas');
  });

  it('offers nothing for an unknown name', () => {
    expect(suggestPhoneLink([{ name: 'Shiv Jayanagar', phone: null }], book)).toBeNull();
  });
});

describe('phoneLinkButtonTitle', () => {
  it('fits WhatsApp\'s 20-character button limit', () => {
    for (const name of ['Vasundhara', 'Durga Prasad (Debi Prasad) Purva Atmosphere Seller', null]) {
      expect(phoneLinkButtonTitle(name).length, String(name)).toBeLessThanOrEqual(20);
    }
  });

  it('uses the first name so the button reads as a person', () => {
    expect(phoneLinkButtonTitle('Vasundhara Purva Atmosphere')).toContain('Vasundhara');
  });
});
