import { describe, expect, it } from 'vitest';
import type { Contact } from '@/types';
import { visitorContactHref } from './visitor-link';

describe('[PLS-002] visitor contact link', () => {
  it('opens the identified visitor’s contact details', () => {
    expect(visitorContactHref({ contact: { id: 'c-42' } as Contact })).toBe(
      '/contacts?contactId=c-42'
    );
  });

  it('gives an anonymous guest no link', () => {
    expect(visitorContactHref({ contact: null })).toBeNull();
  });
});
