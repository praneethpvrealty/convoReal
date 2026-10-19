import { describe, expect, it } from 'vitest';

import { applyShowcaseScope } from './showcase-scope';

const base = 'https://acme.convoreal.com/?ref=acc-1';

describe('applyShowcaseScope', () => {
  it('carries the category only for a whole-showcase share', () => {
    expect(
      applyShowcaseScope(base, {
        scope: 'all',
        category: 'Commercial',
        audience: 'client',
      })
    ).toBe(`${base}&category=Commercial`);
    expect(
      applyShowcaseScope(base, {
        scope: 'all',
        category: 'All',
        audience: 'client',
      })
    ).toBe(base);
  });

  it('replaces the category with the search string', () => {
    const url = applyShowcaseScope(base, {
      scope: 'search',
      category: 'Commercial',
      search: '  vijaya bank  ',
      audience: 'client',
    });
    expect(url).toContain('search=vijaya%20bank');
    expect(url).not.toContain('category=');
  });

  it('pins the resolved results for a structured search', () => {
    const url = applyShowcaseScope(base, {
      scope: 'search',
      search: 'J. P. Nagar',
      ids: ['PROP-101', 'PROP-102'],
      audience: 'client',
    });
    expect(url).toContain('ids=PROP-101%2CPROP-102');
    expect(url).not.toContain('search=');
  });

  it('[PRP-005] carries pinned listings on the share token instead of the URL', () => {
    expect(
      applyShowcaseScope(base, {
        scope: 'search',
        search: 'Commer',
        ids: Array.from({ length: 60 }, (_, i) => `PROP-${2263 - i}`),
        audience: 'client',
        shareId: 'share-1',
      })
    ).toBe(`${base}&s=share-1`);
    expect(
      applyShowcaseScope(base, {
        scope: 'pick',
        ids: ['CR-101', 'CR-102'],
        audience: 'client',
        shareId: 'share-2',
        visitorId: 'contact-9',
      })
    ).toBe(`${base}&s=share-2&v=contact-9`);
  });

  it('[PRP-005] a token minted without pins only labels the share', () => {
    expect(
      applyShowcaseScope(base, {
        scope: 'all',
        category: 'Commercial',
        audience: 'client',
        shareId: 'share-3',
      })
    ).toBe(`${base}&category=Commercial&s=share-3`);
  });

  it('pins a hand-picked set with ids, and omits it when empty', () => {
    expect(
      applyShowcaseScope(base, {
        scope: 'pick',
        ids: ['CR-101', 'CR-102'],
        audience: 'client',
      })
    ).toContain('ids=CR-101%2CCR-102');
    expect(
      applyShowcaseScope(base, { scope: 'pick', ids: [], audience: 'client' })
    ).toBe(base);
  });

  it('[PRP-009] adds co-broker mode and the recipient tag', () => {
    const url = applyShowcaseScope(base, {
      scope: 'all',
      audience: 'agent',
      visitorId: 'contact-9',
    });
    expect(url).toContain('mode=view');
    expect(url).toContain('v=contact-9');
  });
});
