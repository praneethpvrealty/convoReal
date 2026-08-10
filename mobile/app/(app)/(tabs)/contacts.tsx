import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { TAB_BAR_CLEARANCE } from '@/app/(app)/(tabs)/_layout';
import { AppDialog, useAppDialog } from '@/components/app-dialog';
import {
  ApproveCelebration,
  type ApproveCelebrationState,
} from '@/components/approve-celebration';
import { EnterRow, PressScale, PulseRing } from '@/components/motion';
import { ContextMenu } from '@/components/context-menu';
import { ContactFiltersSheet } from '@/components/contact-filters-sheet';
import { InterestFilterSheet } from '@/components/interest-filter-sheet';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import {
  Avatar,
  Banner,
  ConversationSkeleton,
  EmptyState,
  FilterChip,
  IconButton,
  PrimaryButton,
  SearchBar,
  SectionLabel,
  Tag,
  TextField,
  listCard,
  nameTagCap,
} from '@/components/ui';
import { apiFetch, ApiError, isCancelled, isTimeout } from '@/lib/api';
import { approveAndSendDetails } from '@/lib/approve-contact';
import {
  activeFilterCount,
  EMPTY_FILTERS,
  filtersKey,
  sortColumn,
  type ContactFilters,
} from '@/lib/contact-filters';
import {
  interestChipLabel,
  type InterestFilter,
} from '@/lib/contact-interest';
import { friendlyError } from '@/lib/errors';
import { chatListTime, cleanPhoneInput, formatBudgetRange } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { openContactChat } from '@/lib/open-chat';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import {
  classificationColors,
  radius,
  spacing,
  useTheme,
  fonts,
} from '@/lib/theme';
import { useCallLog } from '@/lib/use-call-log';
import { useDebounced } from '@/lib/use-debounced';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { openWelcomeWhatsApp } from '@/lib/welcome-message';
import {
  CLASSIFICATIONS,
  type Classification,
  type Contact,
} from '@/lib/types';

/** Web parity quick filters (contacts-content.tsx). */
const SEGMENTS = [
  { key: 'active', label: 'All' },
  { key: 'pending_review', label: 'Needs Review' },
  { key: 'favorites', label: 'Favourites' },
  { key: 'transacted', label: 'Transacted' },
  { key: 'market_active', label: 'Active Buyers' },
] as const;
type SegmentKey = (typeof SEGMENTS)[number]['key'];

export interface ContactsPage {
  contacts: Contact[];
  /** contact_id → tag names (first few). */
  tags: Record<string, string[]>;
  /** property_id → property_code, for "Interested in" chips. */
  propertyCodes: Record<string, string>;
  /** property_id → title, for the "Contacted about" line on review rows. */
  propertyTitles: Record<string, string>;
  /** contact_id → the property_id that satisfied the "Enquired for"
   *  filter. Only interesting under a project filter, where each row
   *  matched a different unit of the tower. */
  interestMatches: Record<string, string>;
}

const EMPTY_PAGE: ContactsPage = {
  contacts: [],
  tags: {},
  propertyCodes: {},
  propertyTitles: {},
  interestMatches: {},
};

/** Ceiling on the contact ids an interest filter feeds into `.in()` —
 *  the same bound the tag/note search above uses, and the same order as
 *  the list's own limit, so the filter never builds an unbounded URL. */
const INTEREST_CONTACT_CAP = 150;
/** Units of one project scanned for enquiries. Comfortably past any
 *  real tower; a bound, not a product decision. */
const PROJECT_UNIT_CAP = 200;

/** Contacts who named this project in their stated preferences — the
 *  agent-entered list and the AI-extracted one. A tower's buyers mostly
 *  live here rather than on a per-unit enquiry, which is what makes the
 *  project axis worth having. */
async function statedProjectContactIds(project: string): Promise<string[]> {
  const [entered, extracted] = await Promise.all([
    supabase
      .from('contacts')
      .select('id')
      .contains('projects_of_interest', [project])
      .limit(INTEREST_CONTACT_CAP),
    supabase
      .from('contacts')
      .select('id')
      .contains('pref_projects', [project])
      .limit(INTEREST_CONTACT_CAP),
  ]);
  return [...(entered.data ?? []), ...(extracted.data ?? [])].map(
    (r: { id: string }) => r.id
  );
}

/**
 * Resolve the "Enquired for" chip to the contacts it admits.
 *
 * First-choice interest only, matching the web chip: the contact's
 * primary inquiry (`last_inquired_property_id`, set by the property
 * form's interested-contacts link and by the portal-email webhook's
 * top-scored match) or a Manual junction row. Non-Manual junction rows
 * stay out — the webhook historically logged every fuzzy match, so a
 * type-only near-miss would drag unrelated contacts in.
 */
async function resolveInterest(interest: InterestFilter): Promise<{
  contactIds: string[];
  matches: Record<string, string>;
}> {
  let propertyIds: string[] = [interest.value];
  if (interest.kind === 'project') {
    // properties.project is the authoritative name even for units that
    // were never linked to a project row (migration 227), so the string
    // is what sees the whole tower.
    const { data } = await supabase
      .from('properties')
      .select('id')
      .eq('project', interest.value)
      .limit(PROJECT_UNIT_CAP);
    propertyIds = (data ?? []).map((p: { id: string }) => p.id);
  }

  const noRows = Promise.resolve({ data: [] as never[] });
  const [inquiryRes, lastRes, stated] = await Promise.all([
    propertyIds.length
      ? supabase
          .from('contact_property_inquiries')
          .select('contact_id, property_id')
          .in('property_id', propertyIds)
          .eq('inquiry_source', 'Manual')
          .limit(INTEREST_CONTACT_CAP)
      : noRows,
    propertyIds.length
      ? supabase
          .from('contacts')
          .select('id, last_inquired_property_id')
          .in('last_inquired_property_id', propertyIds)
          .limit(INTEREST_CONTACT_CAP)
      : noRows,
    interest.kind === 'project'
      ? statedProjectContactIds(interest.value)
      : Promise.resolve([] as string[]),
  ]);

  const matches: Record<string, string> = {};
  const ids = new Set<string>();
  for (const row of (inquiryRes.data ?? []) as {
    contact_id: string;
    property_id: string;
  }[]) {
    ids.add(row.contact_id);
    matches[row.contact_id] ??= row.property_id;
  }
  for (const row of (lastRes.data ?? []) as {
    id: string;
    last_inquired_property_id: string;
  }[]) {
    ids.add(row.id);
    matches[row.id] ??= row.last_inquired_property_id;
  }
  for (const id of stated) ids.add(id);

  return { contactIds: Array.from(ids).slice(0, INTEREST_CONTACT_CAP), matches };
}

/**
 * Search parity with the web contacts page (contacts-content.tsx):
 * plain terms match name, name_tag, phone, email, company, requirements
 * and classification — PLUS contacts whose TAGS or NOTES match, resolved
 * to ids first (same technique the web uses for notes). Segments follow
 * the web's quick-filter tabs exactly.
 */
/**
 * Team members message the shared number too, which lands their own
 * phones in `contacts`. They're staff, not leads — keep them out of
 * the list and the segment counts. PostgREST filter string over the
 * common stored formats of each staff number's last 10 digits.
 */
async function staffPhoneFilter(): Promise<string | null> {
  return queryClient.fetchQuery({
    queryKey: ['staff-phone-filter'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('phone')
        .not('phone', 'is', null);
      const digits = Array.from(
        new Set(
          (data ?? [])
            .map((p: { phone: string | null }) =>
              String(p.phone ?? '')
                .replace(/\D/g, '')
                .slice(-10)
            )
            .filter((d) => d.length === 10)
        )
      );
      if (digits.length === 0) return null;
      const variants = digits.flatMap((d) => [d, `91${d}`, `+91${d}`]);
      return `(${variants.map((v) => `"${v}"`).join(',')})`;
    },
  });
}

async function fetchContacts(
  search: string,
  segment: SegmentKey,
  interest: InterestFilter | null,
  filters: ContactFilters
): Promise<ContactsPage> {
  const q = search.trim();
  const staffFilter = await staffPhoneFilter();
  const order = sortColumn(filters.sort);
  let query = supabase
    .from('contacts')
    .select(
      'id, phone, name, name_tag, email, company, classification, avatar_url, lead_temp, ' +
        'status, last_contacted_at, last_inquired_property_id, property_interests, ' +
        'areas_of_interest, min_budget, max_budget, no_budget, is_favorite' +
        // An inner join rather than a fetch-then-`.in()`: a popular tag
        // holds more contacts than an id list can travel in a URL.
        (filters.tagId ? ', contact_tags!inner(tag_id)' : '')
    )
    // Web parity: a chain-only contact is a re-share intermediary's
    // attribution, not a lead of this account.
    .eq('chain_only', false)
    .order(order.column, { ascending: order.ascending, nullsFirst: false })
    .limit(150);

  if (staffFilter) {
    query = query.not('phone', 'in', staffFilter);
  }

  if (filters.tagId) query = query.eq('contact_tags.tag_id', filters.tagId);
  if (filters.classification)
    query = query.eq('classification', filters.classification);
  // A min budget admits the no-budget-set contacts; a max budget cannot,
  // since there is no ceiling to compare. Web does the same.
  if (filters.minBudget !== null)
    query = query.or(`max_budget.gte.${filters.minBudget},no_budget.eq.true`);
  if (filters.maxBudget !== null)
    query = query.lte('max_budget', filters.maxBudget);
  if (filters.area) query = query.contains('areas_of_interest', [filters.area]);

  if (segment === 'active' || segment === 'pending_review') {
    query = query.eq('status', segment);
  } else if (segment === 'favorites') {
    // Unscoped by status, matching the web tab — a starred contact in
    // pending_review is the main thing this segment exists to hold.
    query = query.eq('is_favorite', true);
  } else {
    query = query.eq('status', 'active');
    if (segment === 'transacted') {
      const { data: wonDeals } = await supabase
        .from('deals')
        .select('contact_id')
        .eq('status', 'won');
      const ids = Array.from(
        new Set((wonDeals ?? []).map((d) => d.contact_id).filter(Boolean))
      );
      if (ids.length === 0) return EMPTY_PAGE;
      query = query.in('id', ids);
    } else if (segment === 'market_active') {
      query = query.or(
        'lead_temp.eq.HOT,last_inquired_property_id.not.is.null'
      );
    }
  }

  let interestMatches: Record<string, string> = {};
  if (interest) {
    const scope = await resolveInterest(interest);
    if (scope.contactIds.length === 0) return EMPTY_PAGE;
    interestMatches = scope.matches;
    query = query.in('id', scope.contactIds);
  }

  if (q) {
    const term = `%${q}%`;

    const [tagResult, noteResult] = await Promise.all([
      supabase.from('tags').select('id').ilike('name', term).limit(25),
      supabase
        .from('contact_notes')
        .select('contact_id')
        .ilike('note_text', term)
        .limit(150),
    ]);

    let tagContactIds: string[] = [];
    const tagIds = (tagResult.data ?? []).map((t: { id: string }) => t.id);
    if (tagIds.length > 0) {
      const { data: taggedRows } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', tagIds)
        .limit(150);
      tagContactIds = (taggedRows ?? []).map(
        (r: { contact_id: string }) => r.contact_id
      );
    }
    const noteContactIds = (noteResult.data ?? []).map(
      (r: { contact_id: string }) => r.contact_id
    );

    const matchedIds = Array.from(
      new Set([...tagContactIds, ...noteContactIds])
    ).slice(0, 150);

    let orFilter =
      `name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term},` +
      `email.ilike.${term},company.ilike.${term},requirements.ilike.${term},` +
      `classification.ilike.${term}`;
    // Phone match ignoring formatting: "+91 97006 06010" → "919700606010"
    // matches the stored "+919700606010".
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 4) {
      orFilter += `,phone.ilike.%${digits}%`;
    }
    if (matchedIds.length > 0) {
      orFilter += `,id.in.(${matchedIds.join(',')})`;
    }
    query = query.or(orFilter);
  }

  const { data, error } = await query;
  if (error) throw error;
  const contacts = (data ?? []) as unknown as Contact[];

  // Batch the row decorations: tag chips + interested-property codes.
  // Only last_inquired_property_id is a property id — property_interests
  // holds category strings ("Flat/ Apartment"), which Postgres rejects
  // outright when they reach an id filter.
  const ids = contacts.map((c) => c.id);
  const interestIds = Array.from(
    new Set(
      contacts
        .flatMap((c) => [c.last_inquired_property_id, interestMatches[c.id]])
        .filter((v): v is string => Boolean(v))
    )
  ).slice(0, 100);

  const [tagRows, propRows] = await Promise.all([
    ids.length
      ? supabase
          .from('contact_tags')
          .select('contact_id, tag:tags(name)')
          .in('contact_id', ids)
          .limit(600)
      : Promise.resolve({ data: [] }),
    interestIds.length
      ? supabase
          .from('properties')
          .select('id, property_code, title')
          .in('id', interestIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const tags: Record<string, string[]> = {};
  for (const row of (tagRows.data ?? []) as {
    contact_id: string;
    tag: { name: string } | { name: string }[] | null;
  }[]) {
    const tag = Array.isArray(row.tag) ? row.tag[0] : row.tag;
    if (!tag?.name) continue;
    (tags[row.contact_id] ??= []).push(tag.name);
  }
  if (propRows.error) {
    console.error('[contacts] property decoration failed:', propRows.error);
  }
  const propertyCodes: Record<string, string> = {};
  const propertyTitles: Record<string, string> = {};
  for (const row of (propRows.data ?? []) as {
    id: string;
    property_code: string | null;
    title: string | null;
  }[]) {
    if (row.property_code) propertyCodes[row.id] = row.property_code;
    if (row.title) propertyTitles[row.id] = row.title;
  }

  return { contacts, tags, propertyCodes, propertyTitles, interestMatches };
}

/** Segment counts, same head-count technique as the web tabs. */
async function fetchSegmentCounts(): Promise<Record<SegmentKey, number>> {
  const staffFilter = await staffPhoneFilter();
  const excludeStaff = <
    T extends { not: (c: string, op: string, v: string) => T },
  >(
    q: T
  ): T => (staffFilter ? q.not('phone', 'in', staffFilter) : q);
  const [active, review, favorites, market, wonDeals] = await Promise.all([
    excludeStaff(
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('chain_only', false)
        .eq('status', 'active')
    ),
    excludeStaff(
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('chain_only', false)
        .eq('status', 'pending_review')
    ),
    excludeStaff(
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('chain_only', false)
        .eq('is_favorite', true)
    ),
    excludeStaff(
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('chain_only', false)
        .eq('status', 'active')
        .or('lead_temp.eq.HOT,last_inquired_property_id.not.is.null')
    ),
    supabase.from('deals').select('contact_id').eq('status', 'won'),
  ]);
  const transacted = new Set(
    (wonDeals.data ?? []).map((d) => d.contact_id).filter(Boolean)
  ).size;
  return {
    active: active.count ?? 0,
    pending_review: review.count ?? 0,
    favorites: favorites.count ?? 0,
    transacted,
    market_active: market.count ?? 0,
  };
}

export default function ContactsScreen() {
  const { colors, dark, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<SegmentKey>('active');
  const [interest, setInterest] = useState<InterestFilter | null>(null);
  const [interestOpen, setInterestOpen] = useState(false);
  const [filters, setFilters] = useState<ContactFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [favoritingIds, setFavoritingIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [waMenu, setWaMenu] = useState<{
    contact: Contact;
    x: number;
    y: number;
  } | null>(null);
  // Approving flips the contact, drafts the details and sends them over
  // WhatsApp — several round-trips. The row confirms the tap straight
  // away and the send finishes in the background, so a queue of leads can
  // be worked through without waiting on each one.
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());
  const inFlight = useRef<Set<string>>(new Set());
  // Completed approvals waiting for their follow-up funnel. Held back
  // while anything is still sending: a sheet appearing mid-tap would
  // land on the row the user was aiming at.
  const [celebrations, setCelebrations] = useState<ApproveCelebrationState[]>(
    []
  );
  const celebration =
    approvingIds.size === 0 ? (celebrations[0] ?? null) : null;
  const { show, dialogProps } = useAppDialog();
  const { startCall, callLogProps } = useCallLog();
  // Debounce so multi-step tag/note lookups don't fire per keystroke.
  const debounced = useDebounced(search);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: [
      'contacts',
      debounced,
      segment,
      interest?.kind,
      interest?.value,
      filtersKey(filters),
    ],
    queryFn: () => fetchContacts(debounced, segment, interest, filters),
    // Don't wipe the list to skeletons on every keystroke.
    placeholderData: keepPreviousData,
  });
  const counts = useQuery({
    queryKey: ['contact-counts'],
    queryFn: fetchSegmentCounts,
  });
  const pull = usePullRefresh(() => Promise.all([refetch(), counts.refetch()]));

  /** Desktop-parity approve: no confirmation dialog — flip active and
   *  auto-send the inquired property's details via WhatsApp, then
   *  celebrate with the follow-up funnel (falling back to the thread's
   *  template picker outside the 24-hour window). */
  async function handleApprove(contact: Contact) {
    // Only the same lead twice is refused — approving the next one while
    // this is still sending is the point.
    if (inFlight.current.has(contact.id)) return;
    haptic.tap();
    inFlight.current.add(contact.id);
    setApprovingIds(new Set(inFlight.current));

    let result;
    try {
      result = await approveAndSendDetails(contact);
    } finally {
      inFlight.current.delete(contact.id);
      setApprovingIds(new Set(inFlight.current));
    }

    if (!result.ok) {
      haptic.warn();
      show({
        title: 'Could not approve',
        message: friendlyError(result.error ?? 'Try again.'),
      });
      return;
    }
    haptic.success();
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['contact-counts'] });
    queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
    setCelebrations((queue) => [...queue, { contact, outcome: result }]);
  }

  async function handleToggleFavorite(contact: Contact) {
    if (favoritingIds.has(contact.id)) return;
    const next = !contact.is_favorite;
    haptic.tap();
    setFavoritingIds((prev) => new Set(prev).add(contact.id));

    try {
      await apiFetch(`/api/contacts/${contact.id}/favorite`, {
        method: 'PATCH',
        body: JSON.stringify({ is_favorite: next }),
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-counts'] });
      queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
    } catch (err) {
      haptic.warn();
      show({
        title: 'Could not update favourite',
        message: friendlyError(
          err instanceof Error ? err.message : 'Try again.'
        ),
      });
    } finally {
      setFavoritingIds((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(contact.id);
        return nextSet;
      });
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.titleRow}>
          <Text
            style={[
              styles.title,
              { color: colors.text, fontFamily: f.extrabold },
            ]}
          >
            Contacts
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            {/* User-picked hybrid: the person-with-tie glyph with a tiny
                "Ag" caption — reads as Agents without a full text label. */}
            <Pressable
              hitSlop={8}
              onPress={() => router.push('/(app)/agents')}
              accessibilityRole="button"
              accessibilityLabel="Agents directory"
              style={styles.agentsButton}
            >
              <MaterialCommunityIcons
                name="account-tie-outline"
                size={18}
                color={colors.primary}
              />
              <Text
                style={{
                  fontSize: 9,
                  fontFamily: f.extrabold,
                  color: colors.primary,
                  letterSpacing: 0.2,
                  lineHeight: 10,
                }}
              >
                Ag
              </Text>
            </Pressable>
            <IconButton
              icon="phone-portrait-outline"
              label="Import from phone"
              size={20}
              color={colors.primary}
              onPress={() => setImporting(true)}
            />
            <IconButton
              icon="person-add"
              label="Add contact"
              size={22}
              color={colors.primary}
              onPress={() => setAdding(true)}
            />
          </View>
        </View>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, phone, tag, company…"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          indicatorStyle={dark ? 'white' : 'black'}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{
            gap: spacing.sm,
            paddingBottom: spacing.xs,
            alignItems: 'center',
          }}
        >
          {/* A different axis from the segment pills beside them —
              which stage a contact is at, versus what they want — so
              the two narrowing chips lead the row, ruled off from the
              segments. */}
          <InterestChip
            filter={interest}
            onPress={() => {
              haptic.tap();
              setInterestOpen(true);
            }}
            onClear={() => {
              haptic.tap();
              setInterest(null);
            }}
          />
          <AttributeChip
            count={activeFilterCount(filters)}
            onPress={() => {
              haptic.tap();
              setFiltersOpen(true);
            }}
          />
          <View
            style={[styles.chipRule, { backgroundColor: colors.glassBorder }]}
          />
          {SEGMENTS.map((seg) => {
            // Counts are account-wide. Under any narrowing filter they
            // would contradict the list right below them, so they go.
            const n =
              interest || activeFilterCount(filters) > 0
                ? undefined
                : counts.data?.[seg.key];
            return (
              <FilterChip
                key={seg.key}
                label={n === undefined ? seg.label : `${seg.label} (${n})`}
                active={segment === seg.key}
                onPress={() => setSegment(seg.key)}
              />
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <View>
          {Array.from({ length: 8 }, (_, i) => (
            <ConversationSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={data?.contacts ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{
            paddingTop: spacing.xs,
            paddingBottom: TAB_BAR_CLEARANCE,
          }}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={debounced ? 'No matches' : 'Nothing here yet'}
              subtitle={
                interest
                  ? `Nobody has enquired about ${interest.label} yet — link interested contacts from the listing, or clear the filter.`
                  : activeFilterCount(filters) > 0
                    ? 'No contact matches every filter. Loosen one from the Filters chip.'
                    : debounced
                      ? 'Searched names, phones, tags, notes, company and requirements.'
                      : segment === 'active'
                        ? 'Contacts arrive automatically from WhatsApp conversations and portal leads — or add one with the + button.'
                        : 'No contacts in this segment yet.'
              }
            />
          }
          renderItem={({ item, index }) => (
            <EnterRow index={index}>
              <ContactRow
                contact={item}
                dark={dark}
                contactedProperty={
                  item.status === 'pending_review' &&
                  item.last_inquired_property_id
                    ? data?.propertyTitles?.[item.last_inquired_property_id]
                    : undefined
                }
                // Under a project filter every row matched a different
                // unit, so the row says which one. Under a property
                // filter they all matched the same one and the chip
                // above already says so.
                enquiredProperty={
                  interest?.kind === 'project'
                    ? matchedPropertyLabel(data, item.id)
                    : undefined
                }
                tags={data?.tags[item.id] ?? []}
                onApprove={() => handleApprove(item)}
                approving={approvingIds.has(item.id)}
                onToggleFavorite={() => handleToggleFavorite(item)}
                favoriting={favoritingIds.has(item.id)}
                onPeekStart={() => setPeekId(item.id)}
                onPeekEnd={() =>
                  setPeekId((cur) => (cur === item.id ? null : cur))
                }
                onWhatsAppMenu={(at) => setWaMenu({ contact: item, ...at })}
                onCall={() => startCall(item)}
              />
              {peekId === item.id ? (
                <ContactPeekCard
                  contact={item}
                  tags={data?.tags[item.id] ?? []}
                  propertyCodes={data?.propertyCodes ?? {}}
                />
              ) : null}
            </EnterRow>
          )}
        />
      )}

      <InterestFilterSheet
        visible={interestOpen}
        onClose={() => setInterestOpen(false)}
        active={interest}
        onApply={setInterest}
      />
      <ContactFiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onChange={setFilters}
        resultCount={data?.contacts.length ?? 0}
        loading={isFetching}
      />
      <QuickAddContact visible={adding} onClose={() => setAdding(false)} />
      <DeviceImportSheet
        visible={importing}
        onClose={() => setImporting(false)}
      />
      <ApproveCelebration
        celebration={celebration}
        onClose={() => setCelebrations((queue) => queue.slice(1))}
      />
      <ContextMenu
        anchor={waMenu ? { x: waMenu.x, y: waMenu.y } : null}
        onClose={() => setWaMenu(null)}
        actions={
          waMenu
            ? [
                {
                  icon: 'logo-whatsapp',
                  label: 'Blank WhatsApp chat',
                  onPress: () =>
                    Linking.openURL(
                      `https://wa.me/${waMenu.contact.phone.replace(/\D/g, '')}`
                    ),
                },
                {
                  icon: 'chatbubbles-outline',
                  label: 'Internal message (Inbox)',
                  onPress: async () => {
                    const outcome = await openContactChat(waMenu.contact);
                    if (!outcome.ok && outcome.error) {
                      show({
                        title: 'Could not open thread',
                        message: outcome.error,
                      });
                    }
                  },
                },
              ]
            : []
        }
      />
      <AppDialog {...dialogProps} />
      <AppDialog {...callLogProps} />
    </View>
  );
}

/** The unit a row matched under a project filter, by code if it has one. */
function matchedPropertyLabel(
  page: ContactsPage | undefined,
  contactId: string
): string | undefined {
  const propertyId = page?.interestMatches[contactId];
  if (!propertyId) return undefined;
  return page?.propertyCodes[propertyId] ?? page?.propertyTitles[propertyId];
}

/**
 * The "Enquired for" pill. Dormant it is an invitation with a caret;
 * active it carries the property code or project name and its own
 * clear button, so the filter can be dropped without reopening the
 * sheet to find it.
 */
function InterestChip({
  filter,
  onPress,
  onClear,
}: {
  filter: InterestFilter | null;
  onPress: () => void;
  onClear: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const active = Boolean(filter);
  return (
    <View
      style={[
        styles.interestChip,
        {
          backgroundColor: active ? colors.primary : colors.glass,
          borderColor: active ? colors.primary : colors.glassBorder,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={
          filter
            ? `Enquired for ${filter.label}. Change the filter.`
            : 'Filter by the property or project a contact enquired for'
        }
        accessibilityState={{ selected: active }}
        style={styles.interestChipBody}
      >
        <Ionicons
          name={filter?.kind === 'project' ? 'business' : 'home'}
          size={13}
          color={active ? colors.onPrimary : colors.textMuted}
        />
        <Text
          style={{
            fontSize: 13,
            fontFamily: f.bold,
            color: active ? colors.onPrimary : colors.text,
          }}
          numberOfLines={1}
        >
          {filter ? interestChipLabel(filter) : 'Enquired for'}
        </Text>
        {active ? null : (
          <Ionicons name="chevron-down" size={13} color={colors.textMuted} />
        )}
      </Pressable>
      {active ? (
        <Pressable
          onPress={onClear}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear the enquired-for filter"
        >
          <Ionicons name="close-circle" size={16} color={colors.onPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The rest of the web Filters dialog — classification, tag, budget,
 *  area, sort — behind one chip that carries how many are on. */
function AttributeChip({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const active = count > 0;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={
        active
          ? `Filters, ${count} on. Classification, tag, budget, area and sort.`
          : 'Filters — classification, tag, budget, area and sort'
      }
      accessibilityState={{ selected: active }}
      style={[
        styles.attributeChip,
        {
          backgroundColor: active ? colors.primary : colors.glass,
          borderColor: active ? colors.primary : colors.glassBorder,
        },
      ]}
    >
      <Ionicons
        name="options-outline"
        size={14}
        color={active ? colors.onPrimary : colors.textMuted}
      />
      <Text
        style={{
          fontSize: 13,
          fontFamily: f.bold,
          color: active ? colors.onPrimary : colors.text,
        }}
      >
        {active ? `Filters · ${count}` : 'Filters'}
      </Text>
    </Pressable>
  );
}

/**
 * C3 fix: field agents can capture a walk-in without the web app.
 * Uses POST /api/contacts — the same transactional route the web
 * form calls, so plan limits, rate limits and RLS all apply.
 */
function QuickAddContact({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors, dark, fonts: f } = useTheme();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [classification, setClassification] = useState<Classification>('Buyer');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setName('');
    setPhone('');
    setClassification('Buyer');
    setError(null);
  }

  async function save() {
    const cleanPhone = cleanPhoneInput(phone);
    if (!cleanPhone) {
      setError('Enter a valid phone number (e.g. 9900277111 or +919900277111)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { id } = await apiFetch<{ id: string }>('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({
          phone: cleanPhone,
          name: name.trim() || null,
          classification,
        }),
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      reset();
      onClose();
      router.push(`/(app)/contact/${id}`);
    } catch (e) {
      haptic.warn();
      setError(
        friendlyError(
          e instanceof ApiError ? e.message : 'Could not add the contact'
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={() => {
        reset();
        onClose();
      }}
      contentStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
    >
      <Text
        style={{ fontSize: 17, fontFamily: f.extrabold, color: colors.text }}
      >
        New contact
      </Text>
      {error ? <Banner kind="error" text={error} /> : null}
      <TextField
        placeholder="Name (optional)"
        autoCapitalize="words"
        value={name}
        onChangeText={setName}
      />
      <TextField
        placeholder="Phone · e.g. 99002 77111"
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
      />
      <View style={{ gap: spacing.sm }}>
        <SectionLabel
          text="Classification"
          style={{ color: colors.textMuted }}
        />
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          {CLASSIFICATIONS.map((c) => {
            const active = classification === c;
            const hue = classificationColors[c]?.[dark ? 'dark' : 'light'];
            return (
              <Pressable
                key={c}
                onPress={() => setClassification(c)}
                accessibilityRole="button"
                accessibilityLabel={c}
                accessibilityState={{ selected: active }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radius.full,
                  backgroundColor: active ? colors.primarySoft : colors.surface,
                  borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
                  borderColor: active ? colors.primary : colors.border,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: f.semibold,
                    color: active ? colors.primary : (hue ?? colors.textMuted),
                  }}
                >
                  {c}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <PrimaryButton
        label="Add contact"
        busy={saving}
        disabled={!phone.trim()}
        onPress={save}
      />
      <Text
        style={{ fontSize: 11.5, color: colors.textFaint, textAlign: 'center' }}
      >
        Budgets, notes, tags and more can be added from the contact card.
      </Text>
    </BottomSheet>
  );
}

function ContactRow({
  contact,
  dark,
  tags,
  contactedProperty,
  enquiredProperty,
  onApprove,
  approving,
  onToggleFavorite,
  favoriting,
  onPeekStart,
  onPeekEnd,
  onWhatsAppMenu,
  onCall,
}: {
  contact: Contact;
  dark: boolean;
  tags: string[];
  contactedProperty?: string;
  enquiredProperty?: string;
  onApprove: () => void;
  approving?: boolean;
  onToggleFavorite: () => void;
  favoriting?: boolean;
  onPeekStart: () => void;
  onPeekEnd: () => void;
  onWhatsAppMenu: (at: { x: number; y: number }) => void;
  onCall: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const name = contact.name || contact.phone;
  const clsColor = contact.classification
    ? classificationColors[contact.classification]?.[dark ? 'dark' : 'light']
    : undefined;

  return (
    <PressScale
      onPress={() => router.push(`/(app)/contact/${contact.id}`)}
      // Hold-to-peek: the detail card expands below while the finger
      // is down and collapses on release.
      onLongPress={() => {
        haptic.tap();
        onPeekStart();
      }}
      onPressOut={onPeekEnd}
      accessibilityRole="button"
      accessibilityLabel={`Open contact ${name}. Long press and hold for a quick preview.`}
      contentStyle={StyleSheet.flatten([
        listCard,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ])}
    >
      <Avatar name={name} size={42} />
      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <Text
            style={[
              styles.name,
              { color: colors.text, fontFamily: f.extrabold },
            ]}
            numberOfLines={1}
          >
            {name}
          </Text>
          {contact.name_tag ? (
            <View style={nameTagCap}>
              <Tag label={contact.name_tag} />
            </View>
          ) : null}
          <Pressable
            hitSlop={10}
            onPress={onCall}
            accessibilityRole="button"
            accessibilityLabel={`Call ${name}`}
            style={[styles.inlineCall, { backgroundColor: colors.primarySoft }]}
          >
            <Ionicons name="call" size={13} color={colors.primary} />
          </Pressable>
          {contact.last_contacted_at ? (
            <Text
              style={{
                fontSize: 11,
                color: colors.textFaint,
                marginLeft: 'auto',
                flexShrink: 0,
              }}
            >
              {chatListTime(contact.last_contacted_at)}
            </Text>
          ) : null}
        </View>
        <View style={styles.metaRow}>
          {contact.classification ? (
            <Tag label={contact.classification} color={clsColor} />
          ) : null}
          {tags.slice(0, 2).map((t) => (
            <Tag key={t} label={t} />
          ))}
          {contact.name ? (
            <Text
              style={{ fontSize: 12.5, color: colors.textFaint, flexShrink: 1 }}
              numberOfLines={1}
            >
              {contact.phone}
            </Text>
          ) : null}
        </View>
        {contactedProperty ? (
          <View style={styles.contactedRow}>
            <Ionicons name="home" size={11} color={colors.warning} />
            <Text
              style={{ flex: 1, fontSize: 11.5, color: colors.textMuted }}
              numberOfLines={1}
            >
              Contacted about {contactedProperty}
            </Text>
          </View>
        ) : enquiredProperty ? (
          <View style={styles.contactedRow}>
            <Ionicons name="home" size={11} color={colors.primary} />
            <Text
              style={{ flex: 1, fontSize: 11.5, color: colors.textMuted }}
              numberOfLines={1}
            >
              Enquired about {enquiredProperty}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable
          hitSlop={8}
          onPress={onToggleFavorite}
          disabled={favoriting}
          accessibilityRole="button"
          accessibilityLabel={
            contact.is_favorite
              ? `Remove ${name} from favourites`
              : `Add ${name} to favourites`
          }
          accessibilityState={{ disabled: favoriting, busy: favoriting }}
          style={[
            styles.action,
            {
              backgroundColor: contact.is_favorite
                ? colors.warningSoft
                : 'transparent',
            },
          ]}
        >
          <Ionicons
            name={contact.is_favorite ? 'star' : 'star-outline'}
            size={18}
            color={contact.is_favorite ? colors.warning : colors.textFaint}
          />
        </Pressable>
        {contact.status === 'pending_review' ? (
          // Approved reads as done the instant it is tapped: the amber
          // "needs review" pulse becomes a green tick with the send
          // still running behind it, and the next lead stays tappable.
          <PulseRing
            size={38}
            color={approving ? colors.success : colors.warning}
          >
            <Pressable
              hitSlop={8}
              onPress={onApprove}
              disabled={approving}
              accessibilityRole="button"
              accessibilityLabel={
                approving
                  ? `${name} approved, sending details`
                  : `Approve ${name}`
              }
              accessibilityState={{ disabled: approving, busy: approving }}
              style={[
                styles.action,
                {
                  backgroundColor: approving
                    ? colors.successSoft
                    : colors.warningSoft,
                },
              ]}
            >
              {approving ? (
                <Animated.View entering={FadeIn.duration(180)}>
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={colors.success}
                  />
                </Animated.View>
              ) : (
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={colors.warning}
                />
              )}
            </Pressable>
          </PulseRing>
        ) : null}
        <Pressable
          hitSlop={8}
          onPress={() => {
            haptic.tap();
            openWelcomeWhatsApp(contact);
          }}
          onLongPress={(e) => {
            haptic.tap();
            onWhatsAppMenu({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
          }}
          accessibilityRole="button"
          accessibilityLabel={`WhatsApp ${name} — long press for more send options`}
          style={[styles.action, { backgroundColor: colors.successSoft }]}
        >
          <Ionicons name="logo-whatsapp" size={18} color={colors.success} />
        </Pressable>
      </View>
    </PressScale>
  );
}

/**
 * Hold-to-peek capsule: one row-sized pill under the pressed contact
 * with the two crispest lines (budget / areas / tags), a flashlight
 * accent and a real shadow. Near-opaque fill on purpose — a shadow
 * under translucent glass bleeds through as a grey band.
 */
function ContactPeekCard({
  contact,
  tags,
  propertyCodes,
}: {
  contact: Contact;
  tags: string[];
  propertyCodes: Record<string, string>;
}) {
  const { colors, fonts: f } = useTheme();
  // property_interests are category labels, not ids — they read as-is;
  // only last_inquired_property_id resolves to a property code.
  const inquiredCode = contact.last_inquired_property_id
    ? propertyCodes[contact.last_inquired_property_id]
    : undefined;
  const interests = Array.from(
    new Set(
      [...(contact.property_interests ?? []), inquiredCode].filter(
        (v): v is string => Boolean(v)
      )
    )
  ).slice(0, 2);
  const budget = formatBudgetRange(
    contact.min_budget,
    contact.max_budget,
    contact.no_budget
  );

  const headline =
    [budget ? `Budget ${budget}` : null, contact.company, contact.email]
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ') || 'No preferences captured yet';
  const detail = [
    contact.areas_of_interest?.length
      ? contact.areas_of_interest.slice(0, 2).join(', ')
      : null,
    ...tags.slice(0, 2),
    ...interests.map((code) => `★ ${code}`),
    contact.last_contacted_at
      ? `Last ${chatListTime(contact.last_contacted_at)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(120)}
      style={[
        styles.peekCapsule,
        {
          backgroundColor: colors.surfaceWell,
          borderColor: colors.primary,
          shadowColor: colors.primary,
        },
      ]}
    >
      <View style={[styles.peekTorch, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="flash" size={16} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{ fontSize: 13.5, fontFamily: f.bold, color: colors.text }}
          numberOfLines={1}
        >
          {headline}
        </Text>
        {detail ? (
          <Text
            style={{ fontSize: 12, color: colors.textMuted }}
            numberOfLines={1}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

/**
 * "Import from Phone": pick device contacts (expo-contacts) and
 * create them through POST /api/contacts — the same gated route as
 * the web import, so plan limits and RLS apply per contact.
 */
function DeviceImportSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [rows, setRows] = useState<
    { key: string; name: string; phone: string }[] | null
  >(null);
  const [denied, setDenied] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // Imports run one contact at a time, so the sheet reports where it has
  // got to rather than showing one opaque spinner for the whole batch.
  const [done, setDone] = useState(0);
  const importAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!visible) return;
    setResult(null);
    (async () => {
      // SDK 57 moved the function API behind /legacy (the default export
      // is the new class-based API and throws on these methods). Loaded
      // lazily so an older installed build that predates this native
      // module degrades gracefully instead of crashing the tab at import.
      let DeviceContacts: typeof import('expo-contacts/legacy');
      try {
        DeviceContacts = await import('expo-contacts/legacy');
      } catch {
        setResult(
          'Importing from your phone needs the latest ConvoReal build. Install the newest version to use it.'
        );
        return;
      }
      const { status } = await DeviceContacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setDenied(true);
        return;
      }
      const { data } = await DeviceContacts.getContactsAsync({
        fields: [DeviceContacts.Fields.PhoneNumbers],
        pageSize: 0,
      });
      const seen = new Set<string>();
      const list: { key: string; name: string; phone: string }[] = [];
      for (const c of data) {
        const phone = c.phoneNumbers?.[0]?.number?.replace(/[^\d+]/g, '');
        if (!phone || phone.replace(/\D/g, '').length < 10) continue;
        if (seen.has(phone)) continue;
        seen.add(phone);
        list.push({ key: c.id ?? phone, name: c.name ?? '', phone });
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      setRows(list);
    })();
  }, [visible]);

  const shown = (rows ?? []).filter(
    (r) =>
      !filter.trim() ||
      r.name.toLowerCase().includes(filter.trim().toLowerCase()) ||
      r.phone.includes(filter.trim())
  );

  // Leaving the sheet mid-import abandons the calls rather than letting
  // them run on against a screen nobody is watching.
  useEffect(() => {
    if (!visible) importAbort.current?.abort();
  }, [visible]);

  function cancelImport() {
    haptic.tap();
    importAbort.current?.abort();
  }

  function toggle(key: string) {
    haptic.tap();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function importSelected() {
    const picked = (rows ?? []).filter((r) => selected.has(r.key));
    if (picked.length === 0) return;
    const abort = new AbortController();
    importAbort.current = abort;
    setResult(null);
    setDone(0);
    setBusy(true);
    let ok = 0;
    let failed = 0;
    let timedOut = false;
    // Only meaningful for a single-contact import, where we hand the user
    // straight to the editor. A bulk import has no one contact to open.
    let onlyCreatedId: string | null = null;
    for (const r of picked) {
      if (abort.signal.aborted) break;
      try {
        const created = await apiFetch<{ id: string }>('/api/contacts', {
          method: 'POST',
          signal: abort.signal,
          body: JSON.stringify({
            phone: cleanPhoneInput(r.phone) ?? r.phone,
            name: r.name || null,
            classification: 'Buyer',
            source: 'phone_import',
          }),
        });
        ok++;
        onlyCreatedId = created?.id ?? null;
      } catch (err) {
        if (isCancelled(err)) break;
        if (isTimeout(err)) timedOut = true;
        failed++;
      }
      setDone((n) => n + 1);
    }
    const cancelled = abort.signal.aborted;
    importAbort.current = null;
    setBusy(false);
    setDone(0);
    haptic.success();
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['contact-counts'] });

    // A device contact arrives with only a name and number, so a single
    // import goes straight to the editor to be filled in. Skip the banner
    // and the delay — the destination screen is the confirmation.
    if (picked.length === 1 && ok === 1 && onlyCreatedId) {
      onClose();
      router.push(`/(app)/contact/${onlyCreatedId}?edit=1`);
      return;
    }

    const failureReason = timedOut
      ? 'the server did not respond'
      : 'duplicates or limits';
    setResult(
      cancelled
        ? `Stopped — imported ${ok} contact${ok === 1 ? '' : 's'} before you cancelled.`
        : `Imported ${ok} contact${ok === 1 ? '' : 's'}${failed ? ` · ${failed} failed (${failureReason})` : ''}`
    );
    // Success: give the banner a beat to register, then collapse the
    // sheet — the imported contacts are already in the list behind it.
    // All-failed imports keep the sheet open so the message is read.
    if (ok > 0) {
      setTimeout(onClose, 1200);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Import from phone"
      contentStyle={{ paddingHorizontal: 0 }}
    >
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        {denied ? (
          <Banner
            kind="error"
            text="Contacts permission denied — allow it in system settings to import."
          />
        ) : null}
        {result ? <Banner kind="success" text={result} /> : null}
        <TextField
          placeholder="Filter your phone contacts…"
          value={filter}
          onChangeText={setFilter}
        />
      </View>
      <ScrollView
        style={[sheetScrollArea, { maxHeight: 320 }]}
        contentContainerStyle={{ paddingVertical: spacing.sm }}
      >
        {rows === null && !denied ? (
          <Text
            style={{
              textAlign: 'center',
              padding: spacing.lg,
              color: colors.textMuted,
            }}
          >
            Loading phone contacts…
          </Text>
        ) : (
          shown.slice(0, 200).map((r) => {
            const isSel = selected.has(r.key);
            return (
              <Pressable
                key={r.key}
                onPress={() => toggle(r.key)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSel }}
                accessibilityLabel={r.name || r.phone}
                style={[
                  styles.importRow,
                  { borderTopColor: colors.glassBorder },
                ]}
              >
                <Ionicons
                  name={isSel ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={isSel ? colors.primary : colors.textFaint}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 14,
                      fontFamily: f.semibold,
                      color: colors.text,
                    }}
                    numberOfLines={1}
                  >
                    {r.name || r.phone}
                  </Text>
                  {r.name ? (
                    <Text style={{ fontSize: 12, color: colors.textFaint }}>
                      {r.phone}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          gap: spacing.sm,
        }}
      >
        {busy ? (
          <Text
            style={{
              textAlign: 'center',
              fontSize: 12,
              color: colors.textMuted,
            }}
          >
            Importing {Math.min(done + 1, selected.size)} of {selected.size}…
          </Text>
        ) : null}
        <PrimaryButton
          label={
            selected.size > 0
              ? `Import ${selected.size} selected`
              : 'Select contacts to import'
          }
          busy={busy}
          disabled={selected.size === 0}
          onPress={importSelected}
        />
        {busy ? (
          <Pressable
            onPress={cancelImport}
            accessibilityRole="button"
            accessibilityLabel="Cancel import"
            style={{ alignItems: 'center', paddingVertical: spacing.sm }}
          >
            <Text
              style={{
                fontSize: 13,
                fontFamily: f.semibold,
                color: colors.textMuted,
              }}
            >
              Cancel
            </Text>
          </Pressable>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 30, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  agentsButton: {
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Clipped: a row that still runs long after its children have shrunk
  // must not paint over the favourite/approve/WhatsApp cluster beside it.
  rowBody: { flex: 1, gap: 3, overflow: 'hidden' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: {
    fontSize: 16.5,
    fontFamily: fonts.extrabold,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  // Wraps like the other chip rows (properties specRow,
  // contact-picker metaRow): a classification plus two tags plus the
  // phone does not fit one line, and flex children default to
  // flexShrink: 0 in React Native, so without this they keep their full
  // width and spill over the actions beside them.
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  contactedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  interestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 12,
    borderRadius: radius.full,
    borderWidth: 1,
    maxWidth: 220,
  },
  interestChipBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    paddingLeft: 13,
    paddingRight: 1,
    paddingVertical: 9,
  },
  attributeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipRule: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  inlineCall: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peekCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg + 6,
    marginTop: -4,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  peekTorch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
