import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import MapView, { Marker } from 'react-native-maps';

import { SectionLabel, Tag } from '@/components/ui';
import { formatInr } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme , fonts } from '@/lib/theme';
import type { Property } from '@/lib/types';

const { width: SCREEN_W } = Dimensions.get('window');

async function fetchProperty(id: string): Promise<Property | null> {
  // Single-property reads pass RLS directly, same as the web's
  // count/star queries; only the list/search flow is API-gated.
  const { data, error } = await supabase
    .from('properties')
    .select(
      '*, owner:contacts!properties_owner_contact_id_fkey(id, name, phone, classification, name_tag)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Property | null;
}

export default function PropertyDetailScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pagerRef = useRef<ScrollView>(null);
  const [activeImage, setActiveImage] = useState(0);
  const { data: property, isLoading } = useQuery({
    queryKey: ['property', id],
    queryFn: () => fetchProperty(id),
    enabled: Boolean(id),
  });

  if (isLoading || !property) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <Stack.Screen options={{ headerShown: true, title: 'Property' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const price =
    property.listing_type === 'Rent'
      ? property.rent_per_month
        ? `${formatInr(property.rent_per_month)}/month`
        : '—'
      : formatInr(property.price);
  const place = [property.location, property.sublocality, property.city]
    .filter(Boolean)
    .join(', ');
  const ownerPhone = property.owner?.phone;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 110 }}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: property.property_code || 'Property',
          headerStyle: { backgroundColor: colors.tabBar },
          headerTintColor: colors.text,
        }}
      />

      {property.images?.length ? (
        <View>
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setActiveImage(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))
            }
          >
            {property.images.map((url) => (
              <Image
                key={url}
                source={{ uri: url }}
                style={{ width: SCREEN_W, height: 270 }}
                resizeMode="cover"
              />
            ))}
          </ScrollView>
          {property.images.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.thumbStrip}
              contentContainerStyle={{ gap: 8 }}
            >
              {property.images.slice(0, 8).map((url, i) => (
                <Pressable
                  key={url}
                  onPress={() => {
                    setActiveImage(i);
                    pagerRef.current?.scrollTo({ x: i * SCREEN_W, animated: true });
                  }}
                >
                  <Image
                    source={{ uri: url }}
                    style={[
                      styles.thumb,
                      i === activeImage && { borderColor: '#fff', borderWidth: 2 },
                    ]}
                  />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : (
        <View
          style={{
            height: 170,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primarySoft,
          }}
        >
          <Ionicons name="home-outline" size={40} color={colors.primary} />
        </View>
      )}

      {/* Content sheet overlaps the hero photo (reference pattern). */}
      <View style={[styles.body, { backgroundColor: colors.background }]}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {property.listing_type ? <Tag label={property.listing_type} /> : null}
          {property.status ? <Tag label={property.status} /> : null}
          {property.is_published ? (
            <Tag label="Published" />
          ) : (
            <Tag label="Unpublished" />
          )}
        </View>

        <Text style={[styles.title, { color: colors.text }]}>{property.title}</Text>
        {place ? (
          <Text style={{ fontSize: 13.5, color: colors.textMuted }}>{place}</Text>
        ) : null}
        <Text style={{ fontSize: 24, fontFamily: fonts.extrabold, color: colors.primary }}>{price}</Text>

        <View style={styles.specGrid}>
          <Spec icon="bed-outline" label="Bedrooms" value={numOrDash(property.bedrooms)} />
          <Spec icon="water-outline" label="Bathrooms" value={numOrDash(property.bathrooms)} />
          <Spec
            icon="resize-outline"
            label="Area"
            value={
              property.area_sqft
                ? `${property.area_sqft} ${property.area_unit || 'sqft'}`
                : property.land_area
                  ? `${property.land_area} ${property.land_area_unit || ''}`
                  : '—'
            }
          />
          <Spec icon="compass-outline" label="Facing" value={property.facing_direction || '—'} />
        </View>

        {property.description ? (
          <Section title="Description">
            <Text style={{ fontSize: 14, lineHeight: 21, color: colors.textMuted }}>
              {property.description}
            </Text>
          </Section>
        ) : null}

        {property.features?.length ? (
          <Section title="Features">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {property.features.map((f) => (
                <Tag key={f} label={f} />
              ))}
            </View>
          </Section>
        ) : null}

        {property.owner ? (
          <Section title="Owner">
            <Link href={`/(app)/contact/${property.owner_contact_id}`} asChild>
              {/* Slot child requires one flat style object (no arrays). */}
              <Pressable
                style={StyleSheet.flatten([
                  styles.ownerRow,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ])}
              >
                <Ionicons name="person-circle-outline" size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14.5, fontFamily: fonts.bold, color: colors.text }}>
                    {property.owner.name || property.owner.phone}
                  </Text>
                  {property.owner.name ? (
                    <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                      {property.owner.phone}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </Pressable>
            </Link>
          </Section>
        ) : null}

        {typeof property.latitude === 'number' && typeof property.longitude === 'number' ? (
          <Section title="Location">
            <View style={styles.mapWrap}>
              <MapView
                style={StyleSheet.absoluteFill}
                initialRegion={{
                  latitude: property.latitude,
                  longitude: property.longitude,
                  latitudeDelta: 0.02,
                  longitudeDelta: 0.02,
                }}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
                toolbarEnabled={false}
                onPress={() =>
                  Linking.openURL(
                    property.google_map_link ||
                      `https://maps.google.com/?q=${property.latitude},${property.longitude}`
                  )
                }
              >
                <Marker
                  coordinate={{ latitude: property.latitude, longitude: property.longitude }}
                  pinColor={colors.primary}
                />
              </MapView>
            </View>
          </Section>
        ) : null}

        {property.google_map_link ? (
          <Pressable
            style={[styles.mapButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={() => Linking.openURL(property.google_map_link!)}
          >
            <Ionicons name="map-outline" size={17} color={colors.primary} />
            <Text style={{ fontSize: 14, fontFamily: fonts.semibold, color: colors.primary }}>
              Open in Google Maps
            </Text>
          </Pressable>
        ) : null}

        <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}>
          Editing, AI descriptions, documents and sharing flows live on the web for now.
        </Text>
      </View>
    </ScrollView>

    {/* Sticky price + CTA bar (reference pattern). */}
    <View
      style={[
        styles.bottomBar,
        { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 11, fontFamily: fonts.bold, color: colors.textFaint, letterSpacing: 0.5 }}>
          {property.listing_type === 'Rent' ? 'RENT' : 'PRICE'}
        </Text>
        <Text style={{ fontSize: 21, fontFamily: fonts.extrabold, color: colors.text, letterSpacing: -0.5 }}>
          {price}
        </Text>
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.ctaButton,
          { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
        ]}
        onPress={() =>
          ownerPhone
            ? Linking.openURL(`https://wa.me/${ownerPhone.replace(/\D/g, '')}`)
            : Linking.openURL(
                property.google_map_link ||
                  `https://maps.google.com/?q=${encodeURIComponent(property.title)}`
              )
        }
      >
        <Ionicons
          name={ownerPhone ? 'logo-whatsapp' : 'map-outline'}
          size={17}
          color={colors.onPrimary}
        />
        <Text style={{ color: colors.onPrimary, fontSize: 15, fontFamily: fonts.bold }}>
          {ownerPhone ? 'WhatsApp Owner' : 'Open Maps'}
        </Text>
      </Pressable>
    </View>
    </View>
  );
}

function numOrDash(n: number | null | undefined): string {
  return n ? String(n) : '—';
}

function Spec({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.spec, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={{ fontSize: 11, color: colors.textFaint }}>{label}</Text>
      <Text style={{ fontSize: 13.5, fontFamily: fonts.bold, color: colors.text }}>{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text={title} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.md,
    marginTop: -24,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  title: { fontSize: 21, fontFamily: fonts.extrabold, lineHeight: 27 },
  specGrid: { flexDirection: 'row', gap: spacing.sm },
  spec: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  mapWrap: {
    height: 170,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  thumbStrip: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 12,
  },
  thumb: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: 26,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.full,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
});
