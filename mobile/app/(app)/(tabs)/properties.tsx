import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'react-native';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConversationSkeleton, EmptyState, FilterChip, Tag } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { formatInr } from '@/lib/format';
import { radius, spacing, useTheme } from '@/lib/theme';
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
          onEndReached={() => hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="home-outline"
              title={debounced ? 'No matches' : 'No properties yet'}
              subtitle={
                debounced
                  ? 'Search understands plain language — try an area, budget or BHK count.'
                  : 'Add properties from the web app or by messaging your WhatsApp lister.'
              }
            />
          }
          renderItem={({ item }) => <PropertyCard property={item} />}
        />
      )}
    </View>
  );
}

function PropertyCard({ property }: { property: Property }) {
  const { colors } = useTheme();
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
      <Pressable
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        android_ripple={{ color: colors.border }}
      >
        {cover ? (
          <Image source={{ uri: cover }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={[styles.cover, styles.coverEmpty, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="home-outline" size={28} color={colors.primary} />
          </View>
        )}
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
              {property.title}
            </Text>
            {property.is_starred ? (
              <Ionicons name="star" size={15} color={colors.warning} />
            ) : null}
          </View>
          {place ? (
            <Text style={{ fontSize: 12.5, color: colors.textMuted }} numberOfLines={1}>
              {place}
            </Text>
          ) : null}
          {specs ? (
            <Text style={{ fontSize: 12.5, color: colors.textFaint }} numberOfLines={1}>
              {specs}
            </Text>
          ) : null}
          <View style={styles.cardBottom}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: colors.primary }}>
              {price ?? '—'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {property.listing_type ? <Tag label={property.listing_type} /> : null}
              {property.status ? <Tag label={property.status} /> : null}
            </View>
          </View>
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
    flexDirection: 'row',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
  },
  cover: { width: 96, height: 96, borderRadius: radius.md },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, gap: 3, paddingVertical: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { flex: 1, fontSize: 15.5, fontWeight: '700' },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 'auto',
  },
});
