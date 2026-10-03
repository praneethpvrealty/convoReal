import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/app/(dashboard)/contacts/contacts-content.tsx'),
  'utf8'
);

describe('contacts list reads go through react-query', () => {
  it('keeps no hand-rolled fetch, cache or timeout wiring', () => {
    expect(source).not.toContain('localCache');
    expect(source).not.toContain('Promise.race');
    expect(source).not.toContain('fetchContacts');
    expect(source).not.toContain('fetchTags');
    expect(source).not.toContain('setLoading(');
    expect(source).not.toContain('setFetchFailed(');
    expect(source).not.toContain("from('contacts').select(");
    expect(source).not.toContain('contactListCacheKey');
  });

  it('declares every list read as a namespaced query', () => {
    expect(source).toContain('useQuery(');
    expect(source).toContain('placeholderData: keepPreviousData');
    for (const key of [
      "['contacts', 'list', listParams]",
      "['contacts', 'tags']",
      "['contacts', 'showcase-settings', accountId]",
      "['contacts', 'starred', accountId]",
      "['contacts', 'projects', accountId]",
      "['contacts', 'area-options', accountId]",
    ]) {
      expect(source).toContain(key);
    }
  });

  it('never invalidates the bare contacts prefix, which the duplicates panel shares', () => {
    expect(source).not.toMatch(/queryKey: \['contacts'\] \}/);
    expect(source).toContain("queryKey: ['contacts', 'list'] }");
  });

  it('still reads the deep-link and tab parameters from the URL', () => {
    expect(source).toContain("searchParams?.get('contactId')");
    expect(source).toContain("searchParams?.get('filter')");
    expect(source).toContain("searchParams?.get('interest')");
  });
});
