import { describe, it, expect } from 'vitest';
import { buildShowcaseShareLink } from './showcase-share-link';

const base = {
  baseUrl: 'https://acme.convoreal.com',
  accountId: 'acc-1',
  includeRef: false,
  audience: 'client' as const,
};

describe('buildShowcaseShareLink', () => {
  it('carries the category only for a whole-showcase share', () => {
    expect(
      buildShowcaseShareLink({ ...base, scope: 'all', category: 'Commercial' }),
    ).toBe('https://acme.convoreal.com/?category=Commercial');
    expect(buildShowcaseShareLink({ ...base, scope: 'all', category: 'All' })).toBe(
      'https://acme.convoreal.com/',
    );
  });

  it('replaces the category with the search string', () => {
    const url = buildShowcaseShareLink({
      ...base,
      scope: 'search',
      category: 'Commercial',
      search: '  vijaya bank  ',
    });
    expect(url).toContain('search=vijaya+bank');
    expect(url).not.toContain('category=');
  });

  it('pins a hand-picked set with ids', () => {
    const url = buildShowcaseShareLink({
      ...base,
      scope: 'pick',
      ids: ['CR-101', 'CR-102'],
    });
    expect(url).toContain('ids=CR-101%2CCR-102');
  });

  it('omits ids when nothing is picked', () => {
    expect(buildShowcaseShareLink({ ...base, scope: 'pick', ids: [] })).toBe(
      'https://acme.convoreal.com/',
    );
  });

  it('adds ref, co-broker mode and the visitor tag', () => {
    const url = buildShowcaseShareLink({
      ...base,
      includeRef: true,
      scope: 'all',
      audience: 'agent',
      visitorId: 'contact-9',
    });
    expect(url).toContain('ref=acc-1');
    expect(url).toContain('mode=view');
    expect(url).toContain('v=contact-9');
  });
});
