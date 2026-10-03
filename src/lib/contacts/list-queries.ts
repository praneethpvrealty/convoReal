import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, ShowcaseSettings, Tag } from '@/types';
import { CONTACT_LIST_COLUMNS } from '@/lib/contacts/list-columns';
import {
  AREA_FILTER_COLUMNS,
  areaOverlapFilter,
  areaSearchVariants,
  type AreaOption,
} from '@/lib/contacts/area-variants';
import { projectOptions } from '@/lib/contacts/contact-interest';
import { parsePropertyQuery } from '@/lib/search-parser';
import { STARRED_PROPERTY_CAP } from '@/lib/starred-properties';

type DB = SupabaseClient;

export const CONTACTS_PAGE_SIZE = 25;

// Bounds shared with the mobile port (mobile/app/(app)/(tabs)/contacts.tsx):
// the contact ids an interest filter feeds into `.in()` stay capped so the
// filter never builds an unbounded URL, and one project's units are scanned
// to a ceiling comfortably past any real tower.
const INTEREST_CONTACT_CAP = 150;
const PROJECT_UNIT_CAP = 200;
const PROJECT_SCAN_LIMIT = 400;

export type ContactListTab =
  | 'active'
  | 'pending_review'
  | 'favorites'
  | 'transacted'
  | 'market_active'
  | 'archived';

export interface ContactListParams {
  accountId: string;
  page: number;
  tab: ContactListTab;
  sort: string;
  search: string;
  classification: string;
  tag: string;
  minBudget: string;
  maxBudget: string;
  areas: string[];
  areaVariants: string[];
  interestProperty: string;
  interestProject: string;
}

export interface ContactTabCounts {
  activeCount: number;
  reviewCount: number;
  favoritesCount: number;
  transactedCount: number;
  marketActiveCount: number;
  archivedCount: number;
}

export interface ContactListPage {
  contacts: Contact[];
  totalCount: number;
  counts: ContactTabCounts;
  contactTagsByContact: Record<string, string[]>;
}

export interface StarredProperty {
  id: string;
  property_code: string | null;
  title: string;
}

export async function loadContactsShowcaseSettings(
  db: DB,
  accountId: string
): Promise<ShowcaseSettings | null> {
  const { data } = await db
    .from('showcase_settings')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  return data ?? null;
}

export async function loadTagsMap(db: DB): Promise<Record<string, Tag>> {
  const { data } = await db.from('tags').select('*');
  const map: Record<string, Tag> = {};
  (data ?? []).forEach((t) => (map[t.id] = t));
  return map;
}

// The "Area" filter chips and the search box's locality expansion:
// every stored locality, distinct-counted in SQL and grouped by
// spelling by /api/contacts/area-options. Cached for 5 minutes and —
// unlike fetchTags/fetchContacts — only loaded when the Filters panel
// opens or a search runs, not on every Contacts page mount.
export async function loadAreaOptions(): Promise<AreaOption[]> {
  try {
    const res = await fetch('/api/contacts/area-options');
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: AreaOption[] };
    return Array.isArray(body.data) ? body.data : [];
  } catch {
    return [];
  }
}

// Load the account's starred properties for the quick-filter chips.
// Errors (e.g. migration 120 not applied yet) just hide the chips.
export async function loadStarredProperties(
  db: DB,
  accountId: string
): Promise<StarredProperty[]> {
  const { data } = await db
    .from('properties')
    .select('id, property_code, title')
    .eq('account_id', accountId)
    .eq('is_starred', true)
    .order('updated_at', { ascending: false })
    .limit(STARRED_PROPERTY_CAP);
  return data || [];
}

// Distinct project names for the project filter — read off inventory
// rows, not the projects table, so unlinked units still count.
export async function loadProjectChoices(
  db: DB,
  accountId: string
): Promise<{ name: string; count: number }[]> {
  const { data } = await db
    .from('properties')
    .select('project')
    .eq('account_id', accountId)
    .not('project', 'is', null)
    .limit(PROJECT_SCAN_LIMIT);
  return projectOptions(data ?? []);
}

/** The search box's area clause: a typed locality stands for every
 *  stored spelling of it, so "Brookfield" finds "Brookefield" too. */
const areaSearchClause = (term: string, options: AreaOption[]) => {
  const variants = areaSearchVariants(term, options);
  return variants.length > 0
    ? areaOverlapFilter(AREA_FILTER_COLUMNS, variants)
    : '';
};

export async function loadContactsPage(
  db: DB,
  params: ContactListParams,
  areaOptions: () => Promise<AreaOption[]>
): Promise<ContactListPage> {
  const {
    accountId,
    page,
    tab,
    sort,
    search,
    classification,
    tag,
    minBudget,
    maxBudget,
    areas,
    areaVariants,
    interestProperty,
    interestProject,
  } = params;

  const from = page * CONTACTS_PAGE_SIZE;
  const to = from + CONTACTS_PAGE_SIZE - 1;

  // Fetch profile phone numbers for this account to exclude them
  const { data: profilesData } = await db
    .from('profiles')
    .select('phone')
    .eq('account_id', accountId);

  const profilePhones = (profilesData || [])
    .map((p) => (p.phone ? p.phone.replace(/\D/g, '') : ''))
    .filter((p) => p.length >= 8);

  let internalContactIds: string[] = [];
  if (profilePhones.length > 0) {
    const orConditions = profilePhones
      .map((p) => `phone.like.%${p.slice(-8)}`)
      .join(',');
    const { data: matchingContacts } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .or(orConditions);

    if (matchingContacts) {
      internalContactIds = matchingContacts.map((c) => c.id);
    }
  }

  let query = db
    .from('contacts')
    .select(CONTACT_LIST_COLUMNS, { count: 'exact' })
    .eq('account_id', accountId)
    // A merged contact has been folded into another and is kept only
    // so its history resolves. Listing it shows the same person twice
    // and makes the duplicate check look like it missed a pair it had
    // in fact already merged.
    .eq('is_merged', false)
    // A chain-only contact is a re-share intermediary's attribution,
    // not a lead of this account — someone downstream of a co-broker
    // who registered to forward a link onward. Listing them here is
    // what turns the consent chain into a poachable contact list.
    .eq('chain_only', false);

  if (internalContactIds.length > 0) {
    query = query.not('id', 'in', `(${internalContactIds.join(',')})`);
  }

  // Archived contacts are filed away on purpose: they leave every
  // other view rather than being sprinkled through it, which is
  // the point of archiving a list you can no longer read.
  query =
    tab === 'archived'
      ? query.eq('is_archived', true)
      : query.eq('is_archived', false);

  if (tab === 'archived') {
    // Deliberately unscoped by status — an archived contact is
    // filed regardless of where it sat before.
  } else if (tab === 'active' || tab === 'pending_review') {
    query = query.eq('status', tab);
  } else if (tab === 'favorites') {
    // Intentionally unscoped by status — a contact parked in
    // pending_review is exactly the kind an agent stars to return to.
    query = query.eq('is_favorite', true);
  } else {
    // transacted and market_active are active contacts
    query = query.eq('status', 'active');

    if (tab === 'transacted') {
      const { data: wonDeals } = await db
        .from('deals')
        .select('contact_id')
        .eq('status', 'won');
      const transactedContactIds = Array.from(
        new Set(wonDeals?.map((d) => d.contact_id).filter(Boolean) || [])
      );
      if (transactedContactIds.length > 0) {
        query = query.in('id', transactedContactIds);
      } else {
        query = query.eq('id', '00000000-0000-0000-0000-000000000000');
      }
    } else if (tab === 'market_active') {
      query = query.or(
        'lead_temp.eq.HOT,last_inquired_property_id.not.is.null'
      );
    }
  }

  // Apply sorting logic
  if (sort === 'name_asc') {
    query = query.order('name', { ascending: true, nullsFirst: false });
  } else if (sort === 'name_desc') {
    query = query.order('name', {
      ascending: false,
      nullsFirst: false,
    });
  } else if (sort === 'last_contacted_desc') {
    query = query.order('last_contacted_at', {
      ascending: false,
      nullsFirst: false,
    });
  } else if (sort === 'last_contacted_asc') {
    query = query.order('last_contacted_at', {
      ascending: true,
      nullsFirst: false,
    });
  } else if (sort === 'max_budget_desc') {
    query = query.order('max_budget', {
      ascending: false,
      nullsFirst: false,
    });
  } else if (sort === 'max_budget_asc') {
    query = query.order('max_budget', {
      ascending: true,
      nullsFirst: false,
    });
  } else if (sort === 'updated_desc') {
    query = query.order('updated_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  if (classification !== 'All') {
    query = query.eq('classification', classification);
  }

  if (tag !== 'All') {
    const { data: matchedTags } = await db
      .from('contact_tags')
      .select('contact_id')
      .eq('tag_id', tag);

    const tagContactIds = matchedTags
      ? Array.from(
          new Set(matchedTags.map((t) => t.contact_id).filter(Boolean))
        )
      : [];

    if (tagContactIds.length > 0) {
      query = query.in('id', tagContactIds);
    } else {
      query = query.eq('id', '00000000-0000-0000-0000-000000000000');
    }
  }

  if (interestProperty !== 'All' || interestProject !== 'All') {
    // First-choice interest only: the contact's primary inquiry
    // (last_inquired_property_id — set by the property form's
    // interested-contacts link and by the portal-email webhook's
    // top-scored match) OR a manual log from the contact detail view.
    // Non-Manual junction rows are excluded — the webhook historically
    // recorded every fuzzy match (score >= 2), so a type-only near-miss
    // could drag unrelated contacts into the chip.
    //
    // Under a project filter the same sources run across every unit
    // of the tower, plus contacts who NAMED the project in their
    // stated preferences — the agent-entered list and the
    // AI-extracted one — which is where most of a tower's buyers
    // actually live.
    let interestPropertyIds: string[] = [interestProperty];
    if (interestProject !== 'All') {
      const { data: unitRows } = await db
        .from('properties')
        .select('id')
        .eq('account_id', accountId)
        .eq('project', interestProject)
        .limit(PROJECT_UNIT_CAP);
      interestPropertyIds = (unitRows || []).map((r) => r.id);
    }
    const noRows = Promise.resolve({ data: [] as { id: string }[] });
    const [inquiryRes, lastInquiredRes, enteredRes, extractedRes] =
      await Promise.all([
        interestPropertyIds.length
          ? db
              .from('contact_property_inquiries')
              .select('contact_id')
              .in('property_id', interestPropertyIds)
              .eq('inquiry_source', 'Manual')
              .limit(INTEREST_CONTACT_CAP)
          : Promise.resolve({ data: [] as { contact_id: string }[] }),
        interestPropertyIds.length
          ? db
              .from('contacts')
              .select('id')
              .eq('account_id', accountId)
              .in('last_inquired_property_id', interestPropertyIds)
              .limit(INTEREST_CONTACT_CAP)
          : noRows,
        interestProject !== 'All'
          ? db
              .from('contacts')
              .select('id')
              .eq('account_id', accountId)
              .contains('projects_of_interest', [interestProject])
              .limit(INTEREST_CONTACT_CAP)
          : noRows,
        interestProject !== 'All'
          ? db
              .from('contacts')
              .select('id')
              .eq('account_id', accountId)
              .contains('pref_projects', [interestProject])
              .limit(INTEREST_CONTACT_CAP)
          : noRows,
      ]);
    const interestedIds = Array.from(
      new Set(
        [
          ...(inquiryRes.data?.map((r) => r.contact_id) || []),
          ...(lastInquiredRes.data?.map((r) => r.id) || []),
          ...(enteredRes.data?.map((r) => r.id) || []),
          ...(extractedRes.data?.map((r) => r.id) || []),
        ].filter(Boolean)
      )
    ).slice(0, INTEREST_CONTACT_CAP);
    if (interestedIds.length > 0) {
      query = query.in('id', interestedIds);
    } else {
      query = query.eq('id', '00000000-0000-0000-0000-000000000000');
    }
  }

  if (minBudget !== 'All') {
    const minVal = Number(minBudget);
    query = query.or(`max_budget.gte.${minVal},no_budget.eq.true`);
  }

  if (maxBudget !== 'All') {
    const maxVal = Number(maxBudget);
    query = query.lte('max_budget', maxVal);
  }

  if (areas.length > 0) {
    // Every spelling of every selected area group, against both
    // the explicit (areas_of_interest) and the profile-extracted
    // (pref_areas) preferences.
    query =
      areaVariants.length > 0
        ? query.or(areaOverlapFilter(AREA_FILTER_COLUMNS, areaVariants))
        : query.eq('id', '00000000-0000-0000-0000-000000000000');
  }

  if (search.trim()) {
    const parsed = parsePropertyQuery(search.trim());
    const areaOptionsForSearch = await areaOptions();
    const isNlpQuery =
      parsed.locations.length > 0 ||
      parsed.types.length > 0 ||
      parsed.bedrooms !== null ||
      parsed.minPrice !== null ||
      parsed.maxPrice !== null;

    if (isNlpQuery) {
      // 1. Fetch contact IDs from notes matching locations, types, and bedrooms in parallel
      const getLocNotes = async (): Promise<{ contact_id: string }[]> => {
        if (parsed.locations.length === 0) return [];
        const locFilters = parsed.locations
          .map((loc) => `note_text.ilike.%${loc}%`)
          .join(',');
        const { data } = await db
          .from('contact_notes')
          .select('contact_id')
          .eq('account_id', accountId)
          .or(locFilters);
        return (data as { contact_id: string }[]) || [];
      };

      const getTypeNotes = async (): Promise<{ contact_id: string }[]> => {
        if (parsed.types.length === 0) return [];
        const typeFilters = parsed.types
          .map((type) => `note_text.ilike.%${type}%`)
          .join(',');
        const { data } = await db
          .from('contact_notes')
          .select('contact_id')
          .eq('account_id', accountId)
          .or(typeFilters);
        return (data as { contact_id: string }[]) || [];
      };

      const getBedNotes = async (): Promise<{ contact_id: string }[]> => {
        if (parsed.bedrooms === null) return [];
        const b = parsed.bedrooms;
        const bedFilters = `note_text.ilike.%${b}%bhk%,note_text.ilike.%${b}%bedroom%,note_text.ilike.%${b}%bed%`;
        const { data } = await db
          .from('contact_notes')
          .select('contact_id')
          .eq('account_id', accountId)
          .or(bedFilters);
        return (data as { contact_id: string }[]) || [];
      };

      // 2. Fetch contact IDs from tags matching types
      const getTagContactIds = async (): Promise<string[]> => {
        if (parsed.types.length === 0) return [];
        const tagFilters = parsed.types.map((t) => `name.ilike.${t}`).join(',');
        const { data: tags } = await db
          .from('tags')
          .select('id')
          .or(tagFilters);

        const tagIds = (tags || []).map((t) => t.id);
        if (tagIds.length === 0) return [];
        const { data: ctData } = await db
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', tagIds);
        return (ctData || []).map((ct) => ct.contact_id).filter(Boolean);
      };

      const [locNotes, typeNotes, bedNotes, tagContactIds] = await Promise.all([
        getLocNotes(),
        getTypeNotes(),
        getBedNotes(),
        getTagContactIds(),
      ]);

      const locNoteContactIds = Array.from(
        new Set(locNotes.map((n) => n.contact_id).filter(Boolean))
      );
      const typeNoteContactIds = Array.from(
        new Set(typeNotes.map((n) => n.contact_id).filter(Boolean))
      );
      const bedNoteContactIds = Array.from(
        new Set(bedNotes.map((n) => n.contact_id).filter(Boolean))
      );

      // Combine type note and tag IDs
      const typeContactIds = Array.from(
        new Set([...typeNoteContactIds, ...tagContactIds])
      );

      // Limit lists to prevent URL length limits (HTTP 414)
      const safeLocIds = locNoteContactIds.slice(0, 150);
      const safeTypeIds = typeContactIds.slice(0, 150);
      const safeBedIds = bedNoteContactIds.slice(0, 150);

      // 3. Apply location filters
      if (parsed.locations.length > 0) {
        let locOrs = parsed.locations
          .map(
            (loc) =>
              `requirements.ilike.%${loc}%,` +
              (areaSearchClause(loc, areaOptionsForSearch) ||
                `areas_of_interest.cs.{"${loc}"},pref_areas.cs.{"${loc}"}`)
          )
          .join(',');
        if (safeLocIds.length > 0) {
          locOrs += `,id.in.(${safeLocIds.join(',')})`;
        }
        query = query.or(locOrs);
      }

      // 4. Apply type filters
      if (parsed.types.length > 0) {
        let typeOrs = parsed.types
          .map(
            (t) => `requirements.ilike.%${t}%,property_interests.cs.{"${t}"}`
          )
          .join(',');
        if (safeTypeIds.length > 0) {
          typeOrs += `,id.in.(${safeTypeIds.join(',')})`;
        }
        query = query.or(typeOrs);
      }

      // 5. Apply bedroom filters
      if (parsed.bedrooms !== null) {
        const b = parsed.bedrooms;
        let bedOrs = `requirements.ilike.%${b}%bhk%,requirements.ilike.%${b}%bedroom%,requirements.ilike.%${b}%bed%`;
        if (safeBedIds.length > 0) {
          bedOrs += `,id.in.(${safeBedIds.join(',')})`;
        }
        query = query.or(bedOrs);
      }

      // 6. Apply budget filters (overlap logic)
      if (parsed.maxPrice !== null) {
        query = query.or(
          `min_budget.lte.${parsed.maxPrice},min_budget.is.null`
        );
      }
      if (parsed.minPrice !== null) {
        query = query.or(
          `max_budget.gte.${parsed.minPrice},max_budget.is.null,no_budget.eq.true`
        );
      }

      // 7. Fallback for remaining search text
      if (parsed.remainingSearch) {
        const term = `%${parsed.remainingSearch}%`;
        const cleanSearch = parsed.remainingSearch
          .trim()
          .replace(/["'{}\\]/g, '');
        const { data: matchedNotes } = await db
          .from('contact_notes')
          .select('contact_id')
          .eq('account_id', accountId)
          .ilike('note_text', term);

        const remainingNoteContactIds = matchedNotes
          ? Array.from(
              new Set(matchedNotes.map((n) => n.contact_id).filter(Boolean))
            )
          : [];
        const safeRemainingIds = remainingNoteContactIds.slice(0, 150);

        let orFilter = `name.ilike.${term},second_name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term},email.ilike.${term},company.ilike.${term},source.ilike.${term},requirements.ilike.${term},classification.ilike.${term}`;
        if (cleanSearch) {
          orFilter += `,secondary_phones.cs.{"${cleanSearch}"}`;
        }
        const remainingAreas = areaSearchClause(
          parsed.remainingSearch,
          areaOptionsForSearch
        );
        if (remainingAreas) {
          orFilter += `,${remainingAreas}`;
        }
        if (safeRemainingIds.length > 0) {
          orFilter += `,id.in.(${safeRemainingIds.join(',')})`;
        }
        query = query.or(orFilter);
      }
    } else {
      // Simple text-search query fallback
      const term = `%${search.trim()}%`;
      const cleanSearch = search.trim().replace(/["'{}\\]/g, '');
      const { data: matchedNotes } = await db
        .from('contact_notes')
        .select('contact_id')
        .eq('account_id', accountId)
        .ilike('note_text', term);

      const noteContactIds = matchedNotes
        ? Array.from(
            new Set(matchedNotes.map((n) => n.contact_id).filter(Boolean))
          )
        : [];
      const safeNoteIds = noteContactIds.slice(0, 150);

      let orFilter = `name.ilike.${term},second_name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term},email.ilike.${term},company.ilike.${term},source.ilike.${term},requirements.ilike.${term},classification.ilike.${term}`;
      if (cleanSearch) {
        orFilter += `,secondary_phones.cs.{"${cleanSearch}"}`;
      }
      const searchAreas = areaSearchClause(search, areaOptionsForSearch);
      if (searchAreas) {
        orFilter += `,${searchAreas}`;
      }
      if (safeNoteIds.length > 0) {
        orFilter += `,id.in.(${safeNoteIds.join(',')})`;
      }
      query = query.or(orFilter);
    }
  }

  query = query.range(from, to);

  const { data, count, error } = await query;

  if (error) throw error;

  // Six tab counters from one scan of the account's contacts
  // (migration 20261003174500); the staff and won-deal rules
  // live in SQL, shared with the mobile tab.
  const { data: tabCountsRow, error: tabCountsError } = await db
    .rpc('contacts_tab_counts', { p_account_id: accountId })
    .maybeSingle<{
      active: number;
      pending_review: number;
      favorites: number;
      transacted: number;
      market_active: number;
      archived: number;
    }>();
  if (tabCountsError) {
    console.error('Error loading contact tab counts:', tabCountsError);
  }
  const counts: ContactTabCounts = {
    activeCount: tabCountsRow?.active ?? 0,
    reviewCount: tabCountsRow?.pending_review ?? 0,
    favoritesCount: tabCountsRow?.favorites ?? 0,
    transactedCount: tabCountsRow?.transacted ?? 0,
    marketActiveCount: tabCountsRow?.market_active ?? 0,
    archivedCount: tabCountsRow?.archived ?? 0,
  };

  const contacts: Contact[] = data ?? [];
  if (contacts.length === 0) {
    return {
      contacts,
      totalCount: count ?? 0,
      counts,
      contactTagsByContact: {},
    };
  }

  // Fetch tags for these contacts
  const contactIds = contacts.map((c) => c.id);
  const { data: contactTags } = await db
    .from('contact_tags')
    .select('contact_id, tag_id')
    .in('contact_id', contactIds);

  const tagsByContact: Record<string, string[]> = {};
  contactTags?.forEach((ct) => {
    if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
    tagsByContact[ct.contact_id].push(ct.tag_id);
  });

  return {
    contacts,
    totalCount: count ?? 0,
    counts,
    contactTagsByContact: tagsByContact,
  };
}
