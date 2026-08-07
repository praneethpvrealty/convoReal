import { describe, it, expect } from 'vitest';
import {
  buildExistingContactPatch,
  type ExistingContactFields,
  type IncomingContactFields,
} from './import-merge';

function existing(
  over: Partial<ExistingContactFields> = {}
): ExistingContactFields {
  return {
    name: null,
    name_tag: null,
    email: null,
    company: null,
    min_budget: null,
    max_budget: null,
    areas_of_interest: null,
    last_inquired_property_id: null,
    ...over,
  };
}

function incoming(
  over: Partial<IncomingContactFields> = {}
): IncomingContactFields {
  return {
    name: null,
    name_tag: null,
    email: null,
    company: null,
    min_budget: null,
    max_budget: null,
    areas_of_interest: [],
    last_inquired_property_id: null,
    ...over,
  };
}

describe('buildExistingContactPatch', () => {
  it('fills blanks the account never had', () => {
    const patch = buildExistingContactPatch(
      existing({ name: 'Asha' }),
      incoming({
        name: 'ASHA K',
        email: 'asha@example.com',
        max_budget: 5500000,
      })
    );
    expect(patch).toEqual({ email: 'asha@example.com', max_budget: 5500000 });
  });

  it('never overwrites what the agent already has', () => {
    // A portal export is thinner than a hand-curated contact, so an
    // import must not downgrade it.
    const patch = buildExistingContactPatch(
      existing({
        name: 'Asha Kumar',
        email: 'real@example.com',
        company: 'Acme',
        max_budget: 20000000,
        areas_of_interest: ['Whitefield'],
      }),
      incoming({
        name: 'Asha',
        email: 'portal@example.com',
        company: 'MagicBricks',
        max_budget: 5500000,
        areas_of_interest: ['HSR'],
      })
    );
    expect(patch).toEqual({});
  });

  it('treats an empty area list as blank, not as data', () => {
    expect(
      buildExistingContactPatch(
        existing({ areas_of_interest: [] }),
        incoming({ areas_of_interest: ['Whitefield'] })
      )
    ).toEqual({ areas_of_interest: ['Whitefield'] });
  });

  it('treats a zero budget as a real value, not a blank', () => {
    // 0 is falsy but a genuine figure; == null is the right test.
    expect(
      buildExistingContactPatch(
        existing({ max_budget: 0 }),
        incoming({ max_budget: 5500000 })
      )
    ).toEqual({});
  });

  it('always takes a newer enquired property', () => {
    // The one field a fresh enquiry should supersede — it is what the
    // property-anchored message names.
    expect(
      buildExistingContactPatch(
        existing({ last_inquired_property_id: 'old-property' }),
        incoming({ last_inquired_property_id: 'new-property' })
      )
    ).toEqual({ last_inquired_property_id: 'new-property' });
  });

  it('leaves the enquired property alone when the file carries none', () => {
    expect(
      buildExistingContactPatch(
        existing({ last_inquired_property_id: 'keep-me' }),
        incoming()
      )
    ).toEqual({});
  });

  it('returns nothing when the row adds nothing, so no write is issued', () => {
    expect(
      buildExistingContactPatch(existing({ name: 'Asha' }), incoming())
    ).toEqual({});
  });
});
