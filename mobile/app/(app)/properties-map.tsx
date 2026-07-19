import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as Linking from 'expo-linking';

import { apiFetch } from '@/lib/api';
import { nativeMapsAvailable } from '@/lib/maps-support';
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
  const { colors, dark, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
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
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: near ? `Map · ${near.label}` : 'Map',
        }}
      />
      {!nativeMapsAvailable ? (
        <MapFallback count={pinned.length} near={near} />
      ) : (
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
      )}

      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
            bottom: Math.max(insets.bottom, spacing.md) + 22,
          },
        ]}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <>
            <Ionicons name="location" size={14} color={colors.primary} />
            <Text style={{ fontSize: 13, fontFamily: f.semibold, color: colors.text }}>
              {pinned.length} of {data?.data.length ?? 0} results have map pins
            </Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Text style={{ fontSize: 13, fontFamily: f.bold, color: colors.primary }}>List</Text>
            </Pressable>
          </>
        )}
      </View>
      <Text style={[styles.hint, { color: colors.textFaint, bottom: Math.max(insets.bottom, spacing.md) }]}>
        Tap a pin, then its card, to open the property.
      </Text>
    </View>
  );
}

/**
 * Expo Go on Android can't draw Google Maps (see lib/maps-support) —
 * explain instead of showing a black canvas, and hand off to the
 * Google Maps app for the current search area.
 */
function MapFallback({ count, near }: { count: number; near: { label: string; latitude: number; longitude: number } | null }) {
  const { colors, fonts: f } = useTheme();
  const mapsUrl = near
    ? `https://maps.google.com/?q=${near.latitude},${near.longitude}`
    : 'https://maps.google.com/?q=Bengaluru';
  return (
    <View style={fallbackStyles.wrap}>
      <View style={[fallbackStyles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
        <Ionicons name="map-outline" size={34} color={colors.primary} />
        <Text style={{ fontSize: 16.5, fontFamily: f.bold, color: colors.text, textAlign: 'center' }}>
          Map tiles need the installed app
        </Text>
        <Text style={{ fontSize: 13.5, lineHeight: 20, color: colors.textMuted, textAlign: 'center' }}>
          Expo Go on Android can't render Google Maps. Your {count} pinned
          result{count === 1 ? '' : 's'} will appear here in the full app build —
          for now, browse them in the List or open the area in Google Maps.
        </Text>
        <Pressable
          onPress={() => Linking.openURL(mapsUrl)}
          accessibilityRole="button"
          accessibilityLabel="Open area in Google Maps"
          style={[fallbackStyles.button, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="navigate-outline" size={16} color={colors.onPrimary} />
          <Text style={{ fontSize: 14, fontFamily: f.bold, color: colors.onPrimary }}>
            Open in Google Maps
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const fallbackStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    maxWidth: 420,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 20,
    minHeight: 46,
  },
});

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
    alignSelf: 'center',
    fontSize: 11,
  },
});
