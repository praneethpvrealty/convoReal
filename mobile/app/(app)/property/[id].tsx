import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { BlurView } from 'expo-blur';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FlyerSheet } from '@/components/flyer-sheet';
import { ConvoRealLoader } from '@/components/loader';
import { PropertyShareSheet } from '@/components/property-share-sheet';
import { SectionLabel, Tag } from '@/components/ui';
import { nativeMapsAvailable } from '@/lib/maps-support';
import { openInMaps } from '@/lib/open-maps';
import { storagePublicUrl } from '@/lib/storage-url';
import { apiFetch, ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme , fonts } from '@/lib/theme';
import type { Property } from '@/lib/types';

/** Scroll clearance so content ends above the sticky price bar. */
const BOTTOM_BAR_CLEARANCE = 110;

/** Web parity: "Equivalent to: ₹15 Crore" under the formatted price. */
function equivalentInr(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null;
  if (n >= 10000000) {
    const cr = (n / 10000000).toFixed(2).replace(/\.00$/, '').replace(/\.(\d)0$/, '.$1');
    return `Equivalent to: ₹${cr} Crore`;
  }
  if (n >= 100000) {
    const lakhs = (n / 100000).toFixed(2).replace(/\.00$/, '').replace(/\.(\d)0$/, '.$1');
    return `Equivalent to: ₹${lakhs} Lakhs`;
  }
  return `Equivalent to: ₹${n.toLocaleString('en-IN')}`;
}

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
  const { colors, dark, fonts: f } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Live window width (module-scope Dimensions is stale on foldables/
  // rotation and broke pager math on wide screens).
  const { width: winW } = useWindowDimensions();
  // Must run before the loading early-return — hooks can't come after
  // a conditional return (hook count would change between renders).
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<ScrollView>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const { data: property, isLoading } = useQuery({
    queryKey: ['property', id],
    queryFn: () => fetchProperty(id),
    enabled: Boolean(id),
  });

  if (isLoading || !property) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={{ headerShown: true, title: 'Property' }} />
        <ConvoRealLoader />
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
  const hasCoords =
    typeof property.latitude === 'number' && typeof property.longitude === 'number';
  // Address-based search so a listing without coordinates still lands on
  // the right place (the title is a description and won't geocode).
  const mapQuery =
    [property.location, property.sublocality, property.city, property.state]
      .filter(Boolean)
      .join(', ') || property.title;
  const ownerPhone = property.owner?.phone;
  const area = property.area_sqft
    ? `${property.area_sqft} ${property.area_unit || 'sqft'}`
    : property.land_area
      ? `${property.land_area} ${property.land_area_unit || ''}`.trim()
      : null;
  const priceWords = equivalentInr(
    property.listing_type === 'Rent' ? property.rent_per_month : property.price
  );
  // Web parity (view mode): dimensions "F x D" splits into frontage/depth.
  const dimParts = (property.dimensions ?? '').includes('x')
    ? (property.dimensions ?? '').split('x').map((d) => d.trim())
    : [];
  const frontage = dimParts.length === 2 ? dimParts[0] : null;
  const depth = dimParts.length === 2 ? dimParts[1] : null;
  // Web parity: specs without a value are hidden, not dashed out.
  const specs = [
    property.bedrooms
      ? { icon: 'bed-outline' as const, label: 'Bedrooms', value: String(property.bedrooms) }
      : null,
    property.bathrooms
      ? { icon: 'water-outline' as const, label: 'Bathrooms', value: String(property.bathrooms) }
      : null,
    property.sublocality
      ? { icon: 'location-outline' as const, label: 'Locality', value: property.sublocality }
      : null,
    area ? { icon: 'resize-outline' as const, label: 'Area', value: area } : null,
    property.facing_direction
      ? { icon: 'compass-outline' as const, label: 'Facing', value: property.facing_direction }
      : null,
    frontage
      ? { icon: 'swap-horizontal-outline' as const, label: 'Frontage', value: `${frontage} ft` }
      : null,
    property.ownership_status
      ? { icon: 'ribbon-outline' as const, label: 'Ownership', value: property.ownership_status }
      : null,
  ].filter((sp): sp is NonNullable<typeof sp> => sp !== null);
  const rentalIncome =
    typeof property.rental_income === 'number' && property.rental_income > 0
      ? property.rental_income
      : null;
  const yieldPct =
    rentalIncome && property.price
      ? Math.round(((rentalIncome * 12) / property.price) * 1000) / 10
      : null;
  // Web parity: "Listing Metadata" key/value rows, all conditional.
  const metadata = [
    property.super_built_area
      ? { label: 'Super Built Area', value: `${property.super_built_area.toLocaleString('en-IN')} Sq.Ft.` }
      : null,
    property.dimensions ? { label: 'Dimensions', value: property.dimensions } : null,
    frontage ? { label: 'Frontage', value: `${frontage} Feet` } : null,
    depth ? { label: 'Depth', value: `${depth} Feet` } : null,
    property.road_width
      ? { label: 'Road Width', value: `${property.road_width} ${property.road_width_unit || 'Feet'}` }
      : null,
    property.land_zone ? { label: 'Land Zone', value: property.land_zone } : null,
    property.ideal_for ? { label: 'Ideal For', value: property.ideal_for } : null,
    rentalIncome
      ? {
          label: 'Rental Income',
          value: `${formatInr(rentalIncome)}/mo${yieldPct ? ` · ${yieldPct}% yield` : ''}`,
        }
      : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: BOTTOM_BAR_CLEARANCE + insets.bottom }}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: property.property_code || 'Property',
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
              setActiveImage(
                Math.round(
                  e.nativeEvent.contentOffset.x /
                    Math.max(1, e.nativeEvent.layoutMeasurement.width)
                )
              )
            }
          >
            {property.images.map((url, i) => (
              <Pressable
                key={url}
                onPress={() => setViewerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`View photo ${i + 1} full screen`}
              >
                <Image
                  source={{ uri: storagePublicUrl(url) }}
                  style={{ width: winW, height: 270 }}
                  resizeMode="cover"
                />
              </Pressable>
            ))}
          </ScrollView>
          {/* Photo counter + expand affordance. */}
          <Pressable
            onPress={() => setViewerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open photo gallery full screen"
            style={styles.expandChip}
          >
            <Ionicons name="expand" size={13} color="#fff" />
            <Text style={styles.expandChipText}>
              {activeImage + 1}/{property.images.length}
            </Text>
          </Pressable>
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
                    pagerRef.current?.scrollTo({ x: i * winW, animated: true });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Photo ${i + 1} of ${property.images!.length}`}
                >
                  <Image
                    source={{ uri: storagePublicUrl(url) }}
                    style={[
                      styles.thumb,
                      i === activeImage && { borderColor: '#fff', borderWidth: 2 },
                    ]}
                  />
                </Pressable>
              ))}
              {property.images.length > 8 ? (
                <Pressable
                  onPress={() => setViewerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`View all ${property.images.length} photos`}
                  style={[styles.thumb, styles.thumbMore]}
                >
                  <Text style={styles.thumbMoreText}>+{property.images.length - 8}</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          ) : null}
          {viewerOpen ? (
            <GalleryViewer
              images={property.images.map(storagePublicUrl)}
              initialIndex={activeImage}
              onClose={() => setViewerOpen(false)}
            />
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
          {property.type ? <Tag label={property.type} /> : null}
          {property.status ? <Tag label={property.status} /> : null}
          {property.listing_source === 'agent' ? (
            <Tag label="Agent Referred" color={colors.readTick} />
          ) : null}
          {property.listing_source === 'whatsapp_lister' ? (
            <Tag label="Via WhatsApp" color={colors.success} />
          ) : null}
          {property.is_published ? (
            <Tag label="Published" />
          ) : (
            <Tag label="Unpublished" />
          )}
        </View>

        <Text style={[styles.title, { color: colors.text, fontFamily: f.extrabold }]}>{property.title}</Text>
        {place ? (
          <Text style={{ fontSize: 13.5, color: colors.textMuted }}>{place}</Text>
        ) : null}
        <Text style={{ fontSize: 24, fontFamily: f.extrabold, color: colors.primary }}>{price}</Text>
        {priceWords ? (
          <Text style={{ fontSize: 12.5, color: colors.success, marginTop: -6 }}>{priceWords}</Text>
        ) : null}

        <ActionRail property={property} />

        {specs.length > 0 ? (
          <View style={styles.specGrid}>
            {specs.map((sp) => (
              <Spec key={sp.label} icon={sp.icon} label={sp.label} value={sp.value} />
            ))}
          </View>
        ) : null}

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

        {metadata.length > 0 ? (
          <Section title="Listing Metadata">
            <View
              style={[
                styles.metaCard,
                { backgroundColor: colors.glass, borderColor: colors.glassBorder },
              ]}
            >
              {metadata.map((row, i) => (
                <View
                  key={row.label}
                  style={[
                    styles.metaRow,
                    i > 0 && { borderTopWidth: 1, borderTopColor: colors.glassBorder },
                  ]}
                >
                  <Text style={{ fontSize: 13, color: colors.textMuted }}>{row.label}</Text>
                  <Text
                    style={{ fontSize: 13.5, fontFamily: f.bold, color: colors.text, flexShrink: 1 }}
                    numberOfLines={2}
                  >
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {property.floor_tenancies?.length ? (
          <Section title="Floor-wise Tenancy (Rent Roll)">
            <View style={{ gap: spacing.sm }}>
              {property.floor_tenancies.map((ft, i) => (
                <View
                  key={i}
                  style={[
                    styles.tenancyCard,
                    { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                  ]}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                    <Text style={{ fontSize: 14, fontFamily: f.bold, color: colors.text, flex: 1 }}>
                      {ft.floor || `Unit ${i + 1}`}
                      {ft.tenant_name ? ` · ${ft.tenant_name}` : ''}
                    </Text>
                    {ft.monthly_rent ? (
                      <Text style={{ fontSize: 13.5, fontFamily: f.extrabold, color: colors.primary }}>
                        {formatInr(Number(ft.monthly_rent))}/mo
                      </Text>
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>
                    {[
                      ft.area_sqft ? `${ft.area_sqft} Sq.Ft.` : null,
                      ft.lease_start || ft.lease_end
                        ? `Lease ${ft.lease_start ?? '…'} → ${ft.lease_end ?? '…'}`
                        : null,
                      ft.lock_in_months ? `Lock-in ${ft.lock_in_months} mo` : null,
                      ft.maintenance ? `Maint: ${ft.maintenance}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {ft.notes ? (
                    <Text style={{ fontSize: 12, color: colors.textFaint }}>{ft.notes}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {property.nearby_highlights?.length ? (
          <Section title="Nearby Landmarks">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {property.nearby_highlights.map((h) => (
                <Tag key={h} label={h} />
              ))}
            </View>
          </Section>
        ) : null}

        {property.notes ? (
          <Section title="Internal Notes · CRM only">
            <View
              style={[
                styles.notesCard,
                { backgroundColor: colors.warningSoft, borderColor: colors.warning },
              ]}
            >
              <Text style={{ fontSize: 13.5, lineHeight: 20, color: colors.text }}>
                {property.notes}
              </Text>
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
                  { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                ])}
              >
                <Ionicons name="person-circle-outline" size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14.5, fontFamily: f.bold, color: colors.text }}>
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
            {!nativeMapsAvailable ? (
              <Pressable
                onPress={() =>
                  openInMaps({
                    latitude: property.latitude,
                    longitude: property.longitude,
                    label: mapQuery,
                    fallbackUrl: property.google_map_link,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Open location in Google Maps"
                style={[styles.mapFallbackRow, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
              >
                <Ionicons name="location" size={18} color={colors.primary} />
                <Text style={{ flex: 1, fontSize: 14, fontFamily: f.semibold, color: colors.text }}>
                  View location in Google Maps
                </Text>
                <Ionicons name="open-outline" size={16} color={colors.textFaint} />
              </Pressable>
            ) : (
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
                  openInMaps({
                    latitude: property.latitude,
                    longitude: property.longitude,
                    label: mapQuery,
                    fallbackUrl: property.google_map_link,
                  })
                }
              >
                <Marker
                  coordinate={{ latitude: property.latitude, longitude: property.longitude }}
                  pinColor={colors.primary}
                />
              </MapView>
            </View>
            )}
          </Section>
        ) : null}

        {/* Only when the owner CTA isn't already the maps button and there's
            no inline map above — keeps a single "open maps" entry point. */}
        {ownerPhone && !hasCoords && (property.google_map_link || place) ? (
          <Pressable
            style={[styles.mapButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={() =>
              openInMaps({
                latitude: property.latitude,
                longitude: property.longitude,
                label: mapQuery,
                fallbackUrl: property.google_map_link,
              })
            }
          >
            <Ionicons name="map-outline" size={17} color={colors.primary} />
            <Text style={{ fontSize: 14, fontFamily: f.semibold, color: colors.primary }}>
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
        {
          // Near-opaque: content scrolling beneath must not read
          // through the bar (Android's experimental blur is weak here).
          backgroundColor: dark ? 'rgba(10,31,22,0.94)' : 'rgba(255,255,255,0.94)',
          borderColor: colors.glassBorder,
          paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm,
        },
      ]}
    >
      <BlurView
        intensity={16}
        tint={dark ? 'dark' : 'light'}
        blurMethod="none"
        style={StyleSheet.absoluteFill}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 11, fontFamily: f.bold, color: colors.textFaint, letterSpacing: 0.5 }}>
          {property.listing_type === 'Rent' ? 'RENT' : 'PRICE'}
        </Text>
        <Text style={{ fontSize: 21, fontFamily: f.extrabold, color: colors.text, letterSpacing: -0.5 }}>
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
            : openInMaps({
                latitude: property.latitude,
                longitude: property.longitude,
                label: mapQuery,
                fallbackUrl: property.google_map_link,
              })
        }
      >
        <Ionicons
          name={ownerPhone ? 'logo-whatsapp' : 'map-outline'}
          size={17}
          color={colors.onPrimary}
        />
        <Text style={{ color: colors.onPrimary, fontSize: 15, fontFamily: f.bold }}>
          {ownerPhone ? 'WhatsApp Owner' : 'Open Maps'}
        </Text>
      </Pressable>
    </View>
    </View>
  );
}

/**
 * Web-parity quick actions. Post Ad stays web-only (the Chrome portal
 * extension); the flyer creator renders server-side via
 * POST /api/properties/[id]/flyer, so it works here too.
 */
function ActionRail({ property }: { property: Property }) {
  const { colors, fonts: f } = useTheme();
  const [busy, setBusy] = useState<'archive' | 'delete' | null>(null);
  const [sharing, setSharing] = useState(false);
  const [flyerOpen, setFlyerOpen] = useState(false);
  const archived = property.status === 'Archived';

  function confirmArchive() {
    Alert.alert(
      archived ? 'Unarchive this property?' : 'Archive this property?',
      archived
        ? 'It becomes Available and shows in searches again.'
        : 'Archived listings are hidden from searches and the showcase.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: archived ? 'Unarchive' : 'Archive', onPress: doArchive },
      ]
    );
  }

  async function doArchive() {
    setBusy('archive');
    try {
      // Same mutation as the web inventory: status flip via PUT.
      await apiFetch(`/api/properties/${property.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: archived ? 'Available' : 'Archived' }),
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['property', property.id] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
    } catch (e) {
      haptic.warn();
      Alert.alert(
        'Could not update',
        friendlyError(e instanceof ApiError ? e.message : 'Try again.')
      );
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete this property?',
      'This permanently removes the listing, its photos and inquiry history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]
    );
  }

  async function doDelete() {
    setBusy('delete');
    try {
      await apiFetch(`/api/properties/${property.id}`, { method: 'DELETE' });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      router.back();
    } catch (e) {
      haptic.warn();
      Alert.alert(
        'Could not delete',
        friendlyError(e instanceof ApiError ? e.message : 'Try again.')
      );
      setBusy(null);
    }
  }

  const actions = [
    {
      key: 'edit',
      icon: 'create-outline' as const,
      label: 'Edit',
      onPress: () => {
        haptic.tap();
        router.push(`/(app)/property-edit?id=${property.id}`);
      },
    },
    {
      key: 'share',
      icon: 'share-social-outline' as const,
      label: 'Share',
      onPress: () => {
        haptic.tap();
        setSharing(true);
      },
    },
    {
      key: 'flyer',
      icon: 'sparkles-outline' as const,
      label: 'Flyer',
      onPress: () => {
        haptic.tap();
        setFlyerOpen(true);
      },
    },
    {
      key: 'archive',
      icon: 'file-tray-outline' as const,
      label: archived ? 'Unarchive' : 'Archive',
      onPress: confirmArchive,
    },
    { key: 'delete', icon: 'trash-outline' as const, label: 'Delete', onPress: confirmDelete, danger: true },
  ];

  return (
    <View style={styles.actionRail}>
      <PropertyShareSheet
        property={property}
        visible={sharing}
        onClose={() => setSharing(false)}
      />
      <FlyerSheet
        property={property}
        visible={flyerOpen}
        onClose={() => setFlyerOpen(false)}
      />
      {actions.map((a) => {
        const isBusy = busy === a.key;
        const fg = a.danger ? colors.danger : colors.primary;
        return (
          <Pressable
            key={a.key}
            onPress={a.onPress}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={`${a.label} property`}
            accessibilityState={{ disabled: busy !== null, busy: isBusy }}
            style={[
              styles.actionPill,
              {
                backgroundColor: a.danger ? colors.dangerSoft : colors.glass,
                borderColor: a.danger ? colors.danger : colors.glassBorder,
                opacity: busy !== null && !isBusy ? 0.5 : 1,
              },
            ]}
          >
            {isBusy ? (
              <ActivityIndicator size="small" color={fg} />
            ) : (
              <Ionicons name={a.icon} size={16} color={fg} />
            )}
            <Text style={{ fontSize: 12.5, fontFamily: f.bold, color: fg }}>{a.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Full-screen photo viewer: paged, pinch-to-zoom on iOS (ScrollView
 * zoom props are iOS-only; Android gets full-screen contain), photo
 * counter and safe-area close button.
 */
function GalleryViewer({
  images,
  initialIndex,
  onClose,
}: {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(u) => u}
          onMomentumScrollEnd={(e) =>
            setIndex(
              Math.round(
                e.nativeEvent.contentOffset.x /
                  Math.max(1, e.nativeEvent.layoutMeasurement.width)
              )
            )
          }
          renderItem={({ item }) => (
            <ScrollView
              style={{ width, height }}
              contentContainerStyle={{ width, height }}
              minimumZoomScale={1}
              maximumZoomScale={4}
              bouncesZoom
            >
              <Image
                source={{ uri: item }}
                style={{ width, height }}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            </ScrollView>
          )}
        />
        <View style={[styles.viewerTopBar, { top: insets.top + spacing.sm }]}>
          <Text style={styles.viewerCounter}>
            {index + 1} / {images.length}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close gallery"
            style={styles.viewerClose}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
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
  const { colors, fonts: f } = useTheme();
  return (
    <View style={[styles.spec, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={{ fontSize: 11, color: colors.textFaint }}>{label}</Text>
      <Text style={{ fontSize: 13.5, fontFamily: f.bold, color: colors.text }}>{value}</Text>
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
  mapFallbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
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
    // Clears the content sheet, which overlaps the hero by 24.
    bottom: 36,
  },
  thumb: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  expandChip: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  expandChipText: { color: '#fff', fontSize: 12, fontFamily: fonts.bold },
  viewerTopBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  viewerCounter: {
    color: '#fff',
    fontSize: 14,
    fontFamily: fonts.bold,
    backgroundColor: 'rgba(0,0,0,0.45)',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  viewerClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 38,
  },
  metaCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  tenancyCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: 4,
  },
  notesCard: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  thumbMore: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  thumbMoreText: { color: '#fff', fontSize: 12.5, fontFamily: fonts.extrabold },
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
