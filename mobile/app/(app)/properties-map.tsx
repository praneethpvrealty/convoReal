import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { apiFetch } from '@/lib/api';
import { formatInr } from '@/lib/format';
import { buildPropertyParams } from '@/app/(app)/(tabs)/properties';
import { usePropertySearch } from '@/lib/property-search-store';
import { mapPin, radius, spacing, useTheme , fonts } from '@/lib/theme';
import type { PropertiesResponse, Property } from '@/lib/types';

const BENGALURU = {
  latitude: 12.9716,
  longitude: 77.5946,
  latitudeDelta: 0.35,
  longitudeDelta: 0.35,
};

/**
 * Map of the CURRENT Properties search (shares the list's filters via
 * the search store) — pins for every result with coordinates. Rows
 * without coordinates simply don't appear; the web has a backfill and
 * the near-search self-heals geocodes over time.
 */
export default function PropertiesMapScreen() {
  const { colors, dark } = useTheme();
  const { search, listing, near } = usePropertySearch();
  const mapRef = useRef<MapView>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['properties-map', search.trim(), listing, near],
    queryFn: async () => {
      // Page 0 — the properties API is 0-indexed.
      const params = buildPropertyParams(0, search.trim(), listing, near);
      params.set('limit', '100');
      return apiFetch<PropertiesResponse>(`/api/properties?${params.toString()}`);
    },
  });

  const pinned = useMemo(
    () =>
      (data?.data ?? []).filter(
        (p): p is Property & { latitude: number; longitude: number } =>
          typeof p.latitude === 'number' && typeof p.longitude === 'number'
      ),
    [data]
  );

  useEffect(() => {
    if (pinned.length === 0) return;
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(
        pinned.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
        { edgePadding: { top: 80, right: 60, bottom: 120, left: 60 }, animated: true }
      );
    }, 350);
    return () => clearTimeout(t);
  }, [pinned]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: near ? `Map · ${near.label}` : 'Map',
          headerStyle: { backgroundColor: colors.tabBar },
          headerTintColor: colors.text,
        }}
      />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={
          near
            ? {
                latitude: near.latitude,
                longitude: near.longitude,
                latitudeDelta: near.radiusKm / 45,
                longitudeDelta: near.radiusKm / 45,
              }
            : BENGALURU
        }
        userInterfaceStyle={dark ? 'dark' : 'light'}
        showsUserLocation={Boolean(near && !near.place_id)}
      >
        {pinned.map((p) => {
          const price =
            p.listing_type === 'Rent'
              ? p.rent_per_month
                ? `${formatInr(p.rent_per_month)}/mo`
                : '—'
              : formatInr(p.price);
          const available = p.status === 'Available';
          return (
            <Marker
              key={p.id}
              coordinate={{ latitude: p.latitude, longitude: p.longitude }}
              title={p.title}
              description={[price, p.sublocality ?? p.city ?? ''].filter(Boolean).join(' · ')}
              onCalloutPress={() => router.push(`/(app)/property/${p.id}`)}
            >
              {/* Reference-style mint price pill instead of a pin. */}
              <View style={[styles.pricePin, !available && styles.pricePinMuted]}>
                <View style={[styles.pinDot, !available && { backgroundColor: mapPin.dotMuted }]} />
                <Text style={[styles.pinText, !available && { color: mapPin.textMuted }]}>{price}</Text>
              </View>
            </Marker>
          );
        })}
      </MapView>

      <View style={[styles.footer, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <>
            <Ionicons name="location" size={14} color={colors.primary} />
            <Text style={{ fontSize: 13, fontFamily: fonts.semibold, color: colors.text }}>
              {pinned.length} of {data?.data.length ?? 0} results have map pins
            </Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Text style={{ fontSize: 13, fontFamily: fonts.bold, color: colors.primary }}>List</Text>
            </Pressable>
          </>
        )}
      </View>
      <Text style={[styles.hint, { color: colors.textFaint }]}>
        Tap a pin, then its card, to open the property.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pricePin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: mapPin.bg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1.5,
    borderColor: mapPin.border,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  pricePinMuted: { backgroundColor: mapPin.bgMuted },
  pinDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: mapPin.dot },
  pinText: { fontSize: 11.5, fontFamily: fonts.extrabold, color: mapPin.text },
  footer: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  hint: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    fontSize: 11,
  },
});
