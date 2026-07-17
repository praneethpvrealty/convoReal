import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/app/(app)/(tabs)/_layout';
import { EnterRow } from '@/components/motion';
import { ConversationSkeleton, EmptyState, FilterChip, Tag } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { formatInr } from '@/lib/format';
import { radius, spacing, useBrandGradient, useTheme } from '@/lib/theme';
import type { PropertiesResponse, Property } from '@/lib/types';

const LISTING_FILTERS = ['All', 'Sale', 'Rent', 'JV/JD', 'Built to Suit'] as const;
type ListingFilter = (typeof LISTING_FILTERS)[number];

const PAGE_SIZE = 20;

/**
 * The inventory list is served by GET /api/properties (same route the
 * web uses) — search there understands natural-language queries and
 * geo filters, so mobile inherits all of it for free.
 */
async function fetchPage(
  page: number,
  search: string,
  listing: ListingFilter
): Promise<PropertiesResponse> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
    exclude_archived: 'true',
  });
  if (search) params.set('search', search);
  if (listing !== 'All') params.set('listing_type', listing);
  return apiFetch<PropertiesResponse>(`/api/properties?${params.toString()}`);
}

export default function PropertiesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [listing, setListing] = useState<ListingFilter>('All');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isFetching, refetch, fetchNextPage, hasNextPage } =
    useInfiniteQuery({
      queryKey: ['properties', debounced, listing],
      queryFn: ({ pageParam }) => fetchPage(pageParam, debounced, listing),
      initialPageParam: 1,
      getNextPageParam: (last) =>
        last.pagination.page < last.pagination.totalPages
          ? last.pagination.page + 1
          : undefined,
      // Keep showing the previous results while a new search loads —
      // otherwise every keystroke wipes the list to skeletons.
      placeholderData: keepPreviousData,
    });

  const properties = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.pagination.total;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.text }]}>Properties</Text>
          {typeof total === 'number' ? (
            <Text style={{ fontSize: 13, color: colors.textMuted }}>{total} listings</Text>
          ) : null}
        </View>
        <View
          style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Ionicons name="search" size={16} color={colors.textFaint} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder='Try "2bhk in whitefield under 80L"'
            placeholderTextColor={colors.textFaint}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.filtersRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {LISTING_FILTERS.map((f) => (
            <FilterChip key={f} label={f} active={listing === f} onPress={() => setListing(f)} />
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <View>
          {Array.from({ length: 6 }, (_, i) => (
            <ConversationSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={properties}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE }}
          onEndReached={() => hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="home-outline"
              title={debounced || listing !== 'All' ? 'No matches' : 'No properties yet'}
              subtitle={
                debounced || listing !== 'All'
                  ? 'No listings match this search and filter. Same engine as the web inventory — areas, budgets and BHK counts only match what you actually have.'
                  : 'Add properties from the web app or by messaging your WhatsApp lister.'
              }
            />
          }
          renderItem={({ item, index }) => (
            <EnterRow index={index}>
              <PropertyCard property={item} />
            </EnterRow>
          )}
        />
      )}
    </View>
  );
}

/** Full-bleed photo card with a gradient scrim — listing-app grammar. */
function PropertyCard({ property }: { property: Property }) {
  const { colors } = useTheme();
  const gradient = useBrandGradient();
  const cover = property.images?.[0];
  const price =
    property.listing_type === 'Rent'
      ? property.rent_per_month
        ? `${formatInr(property.rent_per_month)}/mo`
        : null
      : property.price
        ? formatInr(property.price)
        : null;
  const place = [property.sublocality, property.city].filter(Boolean).join(', ');
  const specs = [
    property.bedrooms ? `${property.bedrooms} BHK` : null,
    property.area_sqft ? `${property.area_sqft} ${property.area_unit || 'sqft'}` : null,
    property.type,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link href={`/(app)/property/${property.id}`} asChild>
      {/* Slot child requires one flat style object (no arrays). */}
      <Pressable
        style={StyleSheet.flatten([styles.card, { backgroundColor: colors.surface }])}
        android_ripple={{ color: colors.border }}
      >
        <View style={styles.coverWrap}>
          {cover ? (
            <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <LinearGradient
              colors={gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFill, styles.coverEmpty]}
            >
              <Ionicons name="home-outline" size={38} color="rgba(255,255,255,0.85)" />
            </LinearGradient>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.72)']}
            style={styles.scrim}
          />
          {property.is_starred ? (
            <View style={styles.starBadge}>
              <Ionicons name="star" size={13} color="#fbbf24" />
            </View>
          ) : null}
          <View style={styles.coverText}>
            <Text style={styles.coverTitle} numberOfLines={1}>
              {property.title}
            </Text>
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverPlace} numberOfLines={1}>
                {place || specs || ' '}
              </Text>
              <Text style={styles.coverPrice}>{price ?? ''}</Text>
            </View>
          </View>
        </View>
        <View style={styles.cardFooter}>
          <Text style={{ flex: 1, fontSize: 12.5, color: colors.textFaint }} numberOfLines={1}>
            {specs}
          </Text>
          {property.listing_type ? <Tag label={property.listing_type} /> : null}
          {property.status ? <Tag label={property.status} /> : null}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, gap: spacing.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 14.5 },
  filtersRow: { height: 52, justifyContent: 'center' },
  filters: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: 'center' },
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radius.xl,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  coverWrap: { height: 190 },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 },
  starBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.full,
    padding: 6,
  },
  coverText: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 10,
    gap: 2,
  },
  coverTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  coverMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  coverPlace: { flex: 1, color: 'rgba(255,255,255,0.85)', fontSize: 12.5 },
  coverPrice: { color: '#fff', fontSize: 16, fontWeight: '800' },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
