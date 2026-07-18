import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { Link } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/app/(app)/(tabs)/_layout';
import { EnterRow } from '@/components/motion';
import { EmptyState, FilterChip, PropertyCardSkeleton, SearchBar } from '@/components/ui';
import {
  apiFetch,
  placeDetails,
  placesAutocomplete,
  sessionToken,
  type PlaceSuggestion,
} from '@/lib/api';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import {
  nearFromLocality,
  usePropertySearch,
  type ListingFilter,
  type NearAnchor,
} from '@/lib/property-search-store';
import { onGradient, radius, shadows, spacing, useBrandGradient, useTheme , fonts } from '@/lib/theme';
import type { PropertiesResponse, Property } from '@/lib/types';

const LISTING_FILTERS: ListingFilter[] = ['All', 'Sale', 'Rent', 'JV/JD', 'Built to Suit'];
const RADIUS_OPTIONS = [2, 5, 10, 25];
const PAGE_SIZE = 20;

/**
 * List served by the web's GET /api/properties. With a near anchor we
 * send the same tiered geo params the web inventory uses (near_lat /
 * near_lng / radius_km, optional near_place_id / near_label) — rows
 * come back with distance_km + location_tier injected.
 */
export function buildPropertyParams(
  page: number,
  search: string,
  listing: ListingFilter,
  near: NearAnchor | null
): URLSearchParams {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
    exclude_archived: 'true',
  });
  if (search) params.set('search', search);
  if (listing !== 'All') params.set('listing_type', listing);
  if (near) {
    params.set('near_lat', String(near.latitude));
    params.set('near_lng', String(near.longitude));
    params.set('radius_km', String(near.radiusKm));
    if (near.place_id) {
      params.set('near_place_id', near.place_id);
      params.set('near_label', near.label);
    }
  }
  return params;
}

export async function fetchPropertyPage(
  page: number,
  search: string,
  listing: ListingFilter,
  near: NearAnchor | null
): Promise<PropertiesResponse> {
  return apiFetch<PropertiesResponse>(
    `/api/properties?${buildPropertyParams(page, search, listing, near).toString()}`
  );
}

export default function PropertiesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { search, listing, near, setSearch, setListing, setNear, setRadius } =
    usePropertySearch();
  const [debounced, setDebounced] = useState('');
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    data,
    isLoading,
    isFetching,
    isPlaceholderData,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
      queryKey: ['properties', debounced, listing, near],
      queryFn: ({ pageParam }) => fetchPropertyPage(pageParam, debounced, listing, near),
      // The properties API is 0-INDEXED (`from = page * limit` in
      // route.ts) — page 1 means "skip the first 20 rows".
      initialPageParam: 0,
      getNextPageParam: (last) => {
        const next = last.pagination.page + 1;
        return next < last.pagination.totalPages ? next : undefined;
      },
      // Keep showing the previous results while a new search loads —
      // otherwise every keystroke wipes the list to skeletons.
      placeholderData: keepPreviousData,
    });

  const properties = data?.pages.flatMap((p) => p.data) ?? [];
  // While a new search resolves, `data` is the PREVIOUS result — don't
  // present its total as if it belonged to the current filters.
  const total = isPlaceholderData ? undefined : data?.pages[0]?.pagination.total;

  async function nearMe() {
    haptic.tap();
    setGeoError(null);
    if (near && !near.place_id) {
      setNear(null); // toggle off
      return;
    }
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGeoError('Location permission denied — enable it in system settings to search near you.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setNear({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        label: 'Near me',
        radiusKm: 5,
      });
      setSearch('');
    } catch {
      setGeoError('Could not get your location — check GPS and try again.');
    } finally {
      setLocating(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.text }]}>Properties</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            {typeof total === 'number' ? (
              <Text style={{ fontSize: 13, color: colors.textMuted }}>{total} listings</Text>
            ) : null}
            <Link href="/(app)/properties-map" asChild>
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="View results on map"
                style={StyleSheet.flatten([styles.mapButton, { backgroundColor: colors.primarySoft }])}
              >
                <Ionicons name="map" size={17} color={colors.primary} />
              </Pressable>
            </Link>
          </View>
        </View>

        <LocalitySearchBox />
      </View>

      <View style={styles.filtersRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          <NearMeChip active={Boolean(near && !near.place_id)} locating={locating} onPress={nearMe} />
          {LISTING_FILTERS.map((f) => (
            <FilterChip key={f} label={f} active={listing === f} onPress={() => setListing(f)} />
          ))}
        </ScrollView>
      </View>

      {near ? (
        <View style={styles.nearBar}>
          <Ionicons name="location" size={13} color={colors.primary} />
          <Text style={{ fontSize: 12.5, fontFamily: fonts.bold, color: colors.primary }}>
            {near.label}
          </Text>
          <View style={{ flexDirection: 'row', gap: 4, marginLeft: spacing.xs }}>
            {RADIUS_OPTIONS.map((km) => (
              <Pressable
                key={km}
                onPress={() => setRadius(km)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Search within ${km} kilometres`}
                accessibilityState={{ selected: near.radiusKm === km }}
                style={{ paddingHorizontal: 4, paddingVertical: 8 }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: fonts.bold,
                    color: near.radiusKm === km ? colors.primary : colors.textFaint,
                    textDecorationLine: near.radiusKm === km ? 'underline' : 'none',
                  }}
                >
                  {km}km
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => setNear(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear location filter"
          >
            <Ionicons name="close-circle" size={16} color={colors.textFaint} />
          </Pressable>
        </View>
      ) : null}
      {geoError ? (
        <Text style={{ fontSize: 12, color: colors.danger, paddingHorizontal: spacing.lg, paddingBottom: 4 }}>
          {geoError}
        </Text>
      ) : null}
      {error ? (
        <Text style={{ fontSize: 12, color: colors.danger, paddingHorizontal: spacing.lg, paddingBottom: 4 }}>
          Search failed: {error instanceof Error ? error.message : 'try again'}
        </Text>
      ) : null}

      {isLoading ? (
        <View>
          {Array.from({ length: 4 }, (_, i) => (
            <PropertyCardSkeleton key={i} />
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
            <View>
              <EmptyState
                icon="home-outline"
                title={debounced || listing !== 'All' || near ? 'No matches' : 'No properties yet'}
                subtitle={
                  near
                    ? `None of your listings are within ${near.radiusKm} km of ${near.label}.`
                    : debounced || listing !== 'All'
                      ? 'No listings match this search and filter. Same engine as the web inventory — areas, budgets and BHK counts only match what you actually have.'
                      : 'Add properties from the web app or by messaging your WhatsApp lister.'
                }
              />
              {near && near.radiusKm < 25 ? (
                <Pressable
                  onPress={() => setRadius(25)}
                  style={{ alignSelf: 'center', marginTop: -20 }}
                >
                  <View
                    style={{
                      backgroundColor: colors.primary,
                      borderRadius: radius.full,
                      paddingHorizontal: 18,
                      paddingVertical: 11,
                    }}
                  >
                    <Text style={{ color: colors.onPrimary, fontSize: 13.5, fontFamily: fonts.bold }}>
                      Search within 25 km
                    </Text>
                  </View>
                </Pressable>
              ) : null}
            </View>
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

function NearMeChip({
  active,
  locating,
  onPress,
}: {
  active: boolean;
  locating: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={locating ? 'Locating you' : 'Search near my location'}
      accessibilityState={{ selected: active, busy: locating }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: radius.full,
        backgroundColor: active ? colors.primary : colors.surfaceRaised,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <Ionicons
        name={locating ? 'navigate' : 'navigate-outline'}
        size={13}
        color={active ? colors.onPrimary : colors.primary}
      />
      <Text
        style={{
          fontSize: 13,
          fontFamily: fonts.semibold,
          color: active ? colors.onPrimary : colors.textMuted,
        }}
      >
        {locating ? 'Locating…' : 'Near me'}
      </Text>
    </Pressable>
  );
}

/**
 * Search box that doubles as the web's LocalityAutocomplete: typing
 * queries /api/maps/autocomplete; picking a suggestion resolves
 * place-details and anchors a radius search. Free-text search still
 * works exactly as before (submit / just stop typing).
 */
function LocalitySearchBox() {
  const { colors } = useTheme();
  const { search, setSearch, setNear } = usePropertySearch();
  const [focused, setFocused] = useState(false);
  const session = useRef(sessionToken());

  const enabled = focused && search.trim().length >= 2;
  const { data: suggestions } = useQuery({
    queryKey: ['locality-suggest', search.trim()],
    enabled,
    queryFn: async () => {
      try {
        const res = await placesAutocomplete(search.trim(), session.current);
        return res.suggestions.slice(0, 4);
      } catch {
        // 501 = no Google key configured; degrade to plain text search.
        return [] as PlaceSuggestion[];
      }
    },
    staleTime: 60_000,
  });

  async function pick(s: PlaceSuggestion) {
    haptic.tap();
    try {
      const { place } = await placeDetails(s.place_id, session.current);
      session.current = sessionToken(); // sessions are single-purchase
      setNear(
        nearFromLocality({
          place_id: place.place_id,
          label: place.name || s.main_text,
          latitude: place.latitude,
          longitude: place.longitude,
        })
      );
      setSearch('');
    } catch {
      // Details failed — fall back to plain text search of the name.
      setSearch(s.main_text);
    }
  }

  return (
    <View>
      <SearchBar
        value={search}
        onChangeText={setSearch}
        placeholder='Area, project, or "2bhk under 80L"'
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />

      {enabled && suggestions && suggestions.length > 0 ? (
        <View
          style={[
            styles.suggestions,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
          ]}
        >
          {suggestions.map((s) => (
            <Pressable
              key={s.place_id}
              style={[styles.suggestionRow, { borderTopColor: colors.border }]}
              onPress={() => pick(s)}
            >
              <Ionicons name="location-outline" size={15} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontFamily: fonts.semibold, color: colors.text }}>
                  {s.main_text}
                </Text>
                {s.secondary_text ? (
                  <Text style={{ fontSize: 11.5, color: colors.textFaint }} numberOfLines={1}>
                    {s.secondary_text}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="locate-outline" size={14} color={colors.textFaint} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Reference-style card: photo framed inside a white card, floating
 * mint status chip + star on the photo, title/price row, location,
 * then bordered spec pills (beds / area / type).
 */
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
              <Ionicons name="home-outline" size={38} color={onGradient.faint} />
            </LinearGradient>
          )}
          {property.listing_type || typeof property.distance_km === 'number' ? (
            <View style={[styles.statusChip, { backgroundColor: colors.mint }]}>
              <View style={[styles.statusDot, { backgroundColor: colors.mintText }]} />
              <Text style={[styles.statusText, { color: colors.mintText }]}>
                {typeof property.distance_km === 'number'
                  ? property.location_tier === 'exact'
                    ? 'In area'
                    : `${property.distance_km} km`
                  : property.listing_type}
              </Text>
            </View>
          ) : null}
          {property.is_starred ? (
            <View style={styles.starBadge}>
              <Ionicons name="star" size={13} color="#F5C33B" />
            </View>
          ) : null}
        </View>

        <View style={styles.cardBody}>
          <View style={styles.titleRow}>
            <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
              {property.title}
            </Text>
            <Text style={[styles.cardPrice, { color: colors.text }]}>{price ?? '—'}</Text>
          </View>
          {place ? (
            <Text style={{ fontSize: 12.5, color: colors.textMuted }} numberOfLines={1}>
              {place}
            </Text>
          ) : null}
          <View style={styles.specRow}>
            {property.bedrooms ? (
              <SpecPill icon="bed-outline" label={`${property.bedrooms} Beds`} />
            ) : null}
            {property.area_sqft ? (
              <SpecPill
                icon="resize-outline"
                label={`${property.area_sqft} ${property.area_unit || 'Sqft'}`}
              />
            ) : null}
            {property.type ? <SpecPill icon="business-outline" label={property.type} /> : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

function SpecPill({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}) {
  const { colors } = useTheme();
  // Reference style: soft filled chips, no border.
  return (
    <View style={[styles.specPill, { backgroundColor: colors.surfaceSunken }]}>
      <Ionicons name={icon} size={13} color={colors.textMuted} />
      <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.textMuted }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, gap: spacing.md, zIndex: 10 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  title: { fontSize: 30, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  mapButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestions: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 20,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  filtersRow: { height: 52, justifyContent: 'center' },
  filters: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: 'center' },
  nearBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  card: {
    ...shadows.card,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radius.xl,
    padding: 10,
  },
  coverWrap: { height: 175, borderRadius: radius.lg, overflow: 'hidden' },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  statusChip: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  statusText: { fontSize: 11.5, fontFamily: fonts.bold },
  starBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.full,
    padding: 6,
  },
  cardBody: { paddingHorizontal: 6, paddingTop: 10, paddingBottom: 4, gap: 4 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardTitle: { flex: 1, fontSize: 16, fontFamily: fonts.extrabold, letterSpacing: -0.2 },
  cardPrice: { fontSize: 16.5, fontFamily: fonts.extrabold, letterSpacing: -0.3 },
  specRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  specPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
});
