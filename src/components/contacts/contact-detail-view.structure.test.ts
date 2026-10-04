import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/components/contacts/contact-detail-view.tsx'),
  'utf8'
);

describe('ContactDetailView reads through react-query', () => {
  it('loads page data with useQuery over the pure loaders', () => {
    expect(source).toContain('useQuery(');
    expect(source).toContain("from '@/lib/contacts/detail-queries'");
    expect(source).toContain("queryKey: ['contact', contactId],");
    expect(source).toContain("queryKey: ['contact', contactId, 'notes']");
    expect(source).toContain("queryKey: ['contact', contactId, 'tags']");
    expect(source).toContain("queryKey: ['contact', contactId, 'deals']");
    expect(source).toContain("queryKey: ['contact', contactId, 'calls']");
    expect(source).toContain("queryKey: ['contact', contactId, 'properties']");
    expect(source).toContain(
      "'shared-properties',\n      allPropertiesQuery.dataUpdatedAt,"
    );
    expect(source).toContain("queryKey: ['contacts', 'all-properties']");
    expect(source).toContain("queryKey: ['contacts', 'showcase-settings']");
  });

  it('searches referrer suggestions on the server instead of loading the book', () => {
    expect(source).not.toContain('loadReferrerCandidates');
    expect(source).not.toContain("'referrer-candidates'");
    expect(source).not.toContain('contactsList');
    expect(source).toContain('searchReferrerCandidates(');
    expect(source).toContain(
      "'contacts',\n      'referrer-search',\n      accountId,\n      contactId,\n      referrerSearch,"
    );
    expect(source).toContain('placeholderData: keepPreviousData');
    expect(source).toContain(
      'setTimeout(() => setReferrerSearch(editReferrer.trim()), 250)'
    );
  });

  it('hands the property pickers the narrowed picker rows', () => {
    expect(source).toContain(
      'const allProperties = allPropertiesQuery.data ?? NO_PICKER_PROPERTIES;'
    );
    expect(source).not.toMatch(/<PartyPanel[^>]*contacts=/);
  });

  it('refreshes after writes by invalidating instead of refetching by hand', () => {
    expect(source).toContain('invalidateQueries(');
    expect(source).not.toContain('const fetchContact = useCallback');
    expect(source).not.toContain('fetchNotes()');
    expect(source).not.toContain('fetchDeals()');
    expect(source).not.toContain('fetchTags()');
    expect(source).not.toContain('fetchCalls()');
    expect(source).not.toContain('fetchAssociatedProperties()');
  });

  it('seeds the edit fields once per contact so a background refetch keeps unsaved edits', () => {
    expect(source).toContain(
      'if (!contact || initializedContactIdRef.current === contact.id) return;'
    );
    expect(source).toContain(
      "queryClient.resetQueries({ queryKey: ['contact'] });"
    );
  });

  it('gates the dependent reads on their inputs', () => {
    expect(source).toContain(
      'enabled: enabled && inquiredProperties.length > 0'
    );
    expect(source).toContain('enabled: enabled && allProperties.length > 0');
  });
});
