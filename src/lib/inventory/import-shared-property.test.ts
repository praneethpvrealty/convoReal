import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '@/lib/auth/account';

type Result = { data: unknown; error: unknown };

function chain(result: Result) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {};
  for (const method of [
    'select',
    'eq',
    'not',
    'limit',
    'insert',
    'upsert',
    'order',
    'in',
  ]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(() => Promise.resolve(result));
  query.single = vi.fn(() => Promise.resolve(result));
  query.then = <T>(onfulfilled: (value: Result) => T | PromiseLike<T>) =>
    Promise.resolve(result).then(onfulfilled);
  return query;
}

const state = vi.hoisted(() => ({
  source: null as Record<string, unknown> | null,
  sources: [] as Array<Record<string, unknown>>,
  sourceLookups: [] as string[][],
  existingCopy: null as { id: string } | null,
  sharers: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
  contacts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'properties') {
        const query = chain({ data: state.sources, error: null });
        query.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: state.source, error: null })
        );
        query.in = vi.fn((_column: string, ids: string[]) => {
          state.sourceLookups.push(ids);
          return query;
        });
        return query;
      }
      if (table === 'accounts') {
        return chain({ data: { name: 'Aryavarta Ventures' }, error: null });
      }
      if (table === 'profiles') {
        return chain({ data: state.sharers, error: null });
      }
      throw new Error(`unexpected admin table ${table}`);
    },
  }),
}));

vi.mock('@/lib/contacts/find-or-create', () => ({
  findOrCreateContact: vi.fn(
    async (_db: unknown, input: Record<string, unknown>) => {
      state.contacts.push(input);
      return { contactId: 'contact-sharer', created: true };
    }
  ),
}));

import {
  importSharedProperty,
  MAX_VIEWER_LOOKUP,
  sharedPropertyImportSource,
  showcaseImportViewers,
} from './import-shared-property';

function ctx(): AccountContext {
  return {
    accountId: 'acct-me',
    userId: 'user-me',
    role: 'agent',
    orgRole: 'org_agent',
    teamId: null,
    isReadOnly: false,
    activeUiLanguage: 'en',
    account: { id: 'acct-me', name: 'Me', defaultLanguage: 'en' },
    supabase: {
      from: (table: string) => {
        if (table !== 'properties') throw new Error(`unexpected ${table}`);
        const query = chain({ data: null, error: null });
        query.insert = vi.fn((row: Record<string, unknown>) => {
          state.inserted.push(row);
          return chain({
            data: { id: 'copy-1', title: row.title },
            error: null,
          });
        });
        query.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: state.existingCopy, error: null })
        );
        return query;
      },
    },
  } as unknown as AccountContext;
}

const villa = {
  id: 'prop-1',
  account_id: 'acct-them',
  title: 'Villa on 5th Cross',
  type: 'Villa',
  location: '12, 5th Cross, Whitefield',
  sublocality: 'Whitefield',
  city: 'Bengaluru',
  google_map_link: 'https://maps.app.goo.gl/abc',
  latitude: 12.97,
  longitude: 77.75,
  locality_place_id: 'place-1',
  locality_canonical: 'whitefield-bengaluru',
  is_published: true,
  showcase_visibility: null,
  location_privacy: null,
};

beforeEach(() => {
  state.source = { ...villa };
  state.existingCopy = null;
  state.sharers = [
    { full_name: 'Priya', phone: '+919900000001', org_role: 'org_manager' },
  ];
  state.inserted = [];
  state.contacts = [];
});

describe('sharedPropertyImportSource', () => {
  it('[PRP-053] replaces the exact address and pin of a location-guarded listing with its locality', () => {
    const masked = sharedPropertyImportSource(villa);
    expect(masked.location).toBe('Whitefield, Bengaluru');
    expect(masked.google_map_link).toBeNull();
    expect(masked.latitude).toBeNull();
    expect(masked.longitude).toBeNull();
    expect(masked.locality_place_id).toBeNull();
    expect(masked.locality_canonical).toBeNull();
    expect(masked.title).toBe(villa.title);
  });

  it('[PRP-053] copies an apartment whose address is public as it is', () => {
    const flat = { ...villa, type: 'Apartment' };
    expect(sharedPropertyImportSource(flat)).toBe(flat);
  });

  it('[PRP-053] honours an explicit privacy override either way', () => {
    expect(
      sharedPropertyImportSource({ ...villa, location_privacy: 'exact' })
        .location
    ).toBe(villa.location);
    expect(
      sharedPropertyImportSource({
        ...villa,
        type: 'Apartment',
        location_privacy: 'locality',
      }).location
    ).toBe('Whitefield, Bengaluru');
  });
});

describe('importSharedProperty', () => {
  it('[PRP-053] copies the listing unpublished, credits the sharer and masks the guarded address', async () => {
    const result = await importSharedProperty(ctx(), 'prop-1');
    expect(result).toEqual({
      kind: 'imported',
      id: 'copy-1',
      title: 'Villa on 5th Cross',
    });
    expect(state.inserted).toHaveLength(1);
    const row = state.inserted[0];
    expect(row.account_id).toBe('acct-me');
    expect(row.user_id).toBe('user-me');
    expect(row.source_property_id).toBe('prop-1');
    expect(row.is_published).toBe(false);
    expect(row.listing_source).toBe('agent');
    expect(row.owner_contact_id).toBe('contact-sharer');
    expect(row.location).toBe('Whitefield, Bengaluru');
    expect(row.google_map_link).toBeNull();
    expect(row.latitude).toBeNull();
    expect(row.locality_canonical).toBeNull();
    expect(state.contacts[0]).toMatchObject({
      accountId: 'acct-me',
      phone: '+919900000001',
      name: 'Priya',
      company: 'Aryavarta Ventures',
      classification: 'Agent',
    });
  });

  it('[PRP-053] withholds a teaser-gated listing', async () => {
    state.source = { ...villa, showcase_visibility: 'teaser' };
    expect(await importSharedProperty(ctx(), 'prop-1')).toEqual({
      kind: 'withheld',
    });
    expect(state.inserted).toHaveLength(0);
  });

  it('[PRP-053] reports a listing of the caller’s own account', async () => {
    state.source = { ...villa, account_id: 'acct-me' };
    expect(await importSharedProperty(ctx(), 'prop-1')).toEqual({
      kind: 'own_listing',
      id: 'prop-1',
    });
  });

  it('[PRP-053] returns the existing copy instead of importing twice', async () => {
    state.existingCopy = { id: 'copy-old' };
    expect(await importSharedProperty(ctx(), 'prop-1')).toEqual({
      kind: 'already_imported',
      id: 'copy-old',
    });
    expect(state.inserted).toHaveLength(0);
  });

  it('[PRP-053] treats an unpublished or unknown listing as not found', async () => {
    state.source = { ...villa, is_published: false };
    expect(await importSharedProperty(ctx(), 'prop-1')).toEqual({
      kind: 'not_found',
    });
    state.source = null;
    expect(await importSharedProperty(ctx(), 'prop-1')).toEqual({
      kind: 'not_found',
    });
  });
});

describe('showcaseImportViewers', () => {
  function viewerCtx(
    overrides: Partial<AccountContext> = {},
    copies: Array<{ id: string; source_property_id: string }> = []
  ) {
    const copyLookups: string[][] = [];
    const base = ctx();
    return {
      copyLookups,
      ctx: {
        ...base,
        ...overrides,
        supabase: {
          from: () => {
            const query = chain({ data: copies, error: null });
            query.in = vi.fn((_column: string, ids: string[]) => {
              copyLookups.push(ids);
              return query;
            });
            return query;
          },
        },
      } as unknown as AccountContext,
    };
  }

  beforeEach(() => {
    state.sourceLookups = [];
    state.sources = [
      { id: 'theirs', account_id: 'acct-them', is_published: true },
      { id: 'copied', account_id: 'acct-them', is_published: true },
      {
        id: 'teaser',
        account_id: 'acct-them',
        is_published: true,
        showcase_visibility: 'teaser',
      },
      { id: 'mine', account_id: 'acct-me', is_published: true },
      { id: 'draft', account_id: 'acct-them', is_published: false },
    ];
  });

  it('[PRP-053] answers every published listing in one lookup, with the caller\u2019s existing copies', async () => {
    const { ctx: c, copyLookups } = viewerCtx({}, [
      { id: 'copy-1', source_property_id: 'copied' },
    ]);
    const viewers = await showcaseImportViewers(c, [
      'theirs',
      'copied',
      'teaser',
      'mine',
      'draft',
      'theirs',
    ]);
    expect(viewers).toEqual({
      theirs: { own: false, canImport: true, importedId: null },
      copied: { own: false, canImport: true, importedId: 'copy-1' },
      teaser: { own: false, canImport: false, importedId: null },
      mine: { own: true, canImport: false, importedId: null },
    });
    expect(state.sourceLookups).toEqual([
      ['theirs', 'copied', 'teaser', 'mine', 'draft'],
    ]);
    expect(copyLookups).toEqual([['theirs', 'copied', 'teaser']]);
  });

  it('[PRP-053] lets neither a read-only member nor a viewer import', async () => {
    for (const overrides of [
      { isReadOnly: true },
      { role: 'viewer' as AccountContext['role'] },
    ]) {
      const viewers = await showcaseImportViewers(viewerCtx(overrides).ctx, [
        'theirs',
      ]);
      expect(viewers.theirs).toEqual({
        own: false,
        canImport: false,
        importedId: null,
      });
    }
  });

  it('[PRP-053] asks nothing for an empty list and refuses more than the limit', async () => {
    expect(await showcaseImportViewers(viewerCtx().ctx, [])).toEqual({});
    expect(state.sourceLookups).toHaveLength(0);
    const tooMany = Array.from(
      { length: MAX_VIEWER_LOOKUP + 1 },
      (_, i) => `p-${i}`
    );
    await expect(
      showcaseImportViewers(viewerCtx().ctx, tooMany)
    ).rejects.toThrow(/no more than/);
    expect(state.sourceLookups).toHaveLength(0);
  });
});
