import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';

import { BlurView } from 'expo-blur';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { FlyerSheet } from '@/components/flyer-sheet';
import { ListingAudienceSheet } from '@/components/listing-audience-sheet';
import { ConvoRealLoader } from '@/components/loader';
import { PropertyShareSheet } from '@/components/property-share-sheet';
import { FilterChip, SectionLabel, Tag, nameTagCap } from '@/components/ui';
import { MatchTargetRow } from '@/components/match-target-row';
import { propertyMapPin } from '@/lib/map-links';
import { nativeMapsAvailable } from '@/lib/maps-support';
import { openInMaps } from '@/lib/open-maps';
import { plansWithImages } from '@/lib/floor-plans';
import { storagePublicUrl } from '@/lib/storage-url';
import { emptyPhotoLabel, internalPhotoSources } from '@/lib/photo-sources';
import { usePhotoSources } from '@/lib/use-photo-source';
import { apiFetch, ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { chatListTime, formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { listingPrice } from '@/lib/listing-price';
import {
  audienceListingLabel,
  fetchListingAudience,
  reachableAudienceIds,
  type AudienceListing,
} from '@/lib/listing-audience';
import {
  inMatchAudience,
  matchChips,
  scoreTone,
  type MatchAudience,
  type MatchChipTone,
} from '@/lib/match-chips';
import {
  fetchPropertyMatches,
  inquiredPropertyLabel,
  type PropertyMatch,
} from '@/lib/property-matches';
import { propertyDetailPrimaryAction } from '@/lib/property-detail-primary-action';
import { rentalYieldPercent } from '@/lib/rental-yield';
import {
  hasBedsBaths,
  hasCommercialBuildingFields,
  hasTotalFloors,
  isApartmentType,
  isLandType,
} from '@/lib/property-options';
import { PropertyDocuments } from '@/components/property-documents';
import { useAuthStore } from '@/lib/auth-store';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import {
  blurredSurfaceColor,
  glassBlurTint,
  radius,
  spacing,
  useTheme,
  fonts,
  type ThemeColors,
} from '@/lib/theme';
import type { Contact, Property } from '@/lib/types';

/** Scroll clearance so content ends above the sticky price bar. */
const BOTTOM_BAR_CLEARANCE = 110;

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
  // Viewers read the dashboard and nothing else (AGENTS.md §8.2); the
  // API enforces it too, this just keeps the buttons honest.
  const canEdit = useAuthStore((s) => s.profile?.account_role) !== 'viewer';
  // Live window width (module-scope Dimensions is stale on foldables/
  // rotation and broke pager math on wide screens).
  const { width: winW } = useWindowDimensions();
  // Must run before the loading early-return — hooks can't come after
  // a conditional return (hook count would change between renders).
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<ScrollView>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedMatchIds, setSelectedMatchIds] = useState<string[]>([]);
  const [shareTo, setShareTo] = useState<Contact[] | null>(null);
  const { data: property, isLoading } = useQuery({
    queryKey: ['property', id],
    queryFn: () => fetchProperty(id),
    enabled: Boolean(id),
  });
  const matchesQuery = useQuery({
    queryKey: ['property-matches', id],
    queryFn: () => fetchPropertyMatches(id),
    enabled: Boolean(id),
    staleTime: 60_000,
  });

  // A gated listing's photos live in the guarded bucket, so the gallery
  // is not `property.images` — those stream through the authenticated
  // proxy instead. Resolved before the early return: it is a hook.
  const photos =
    usePhotoSources(
      property
        ? internalPhotoSources({
            id: property.id,
            images: property.images,
            private_images: property.private_images,
          })
        : []
    ) ?? [];

  if (isLoading || !property) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Stack.Screen options={{ headerShown: true, title: 'Property' }} />
        <ConvoRealLoader />
      </View>
    );
  }

  const price = listingPrice(property);
  const propertyType = property.type || '';
  const isLand = isLandType(propertyType);
  const isApartment = isApartmentType(propertyType);
  const showBedsBaths = hasBedsBaths(propertyType);
  const showCommercialBuildingFields = hasCommercialBuildingFields(propertyType);
  const place = [property.location, property.sublocality, property.city]
    .filter(Boolean)
    .join(', ');
  // Resolved through the shared resolver so the marker, the maps hand-off
  // and every web surface land on one place. Reading `latitude`/`longitude`
  // directly put the app on a different pin from the showcase and the
  // WhatsApp reveal whenever those columns held a geocode of the address
  // rather than the saved link's own coordinates.
  const pin = propertyMapPin(property);
  const coords = pin?.coordinates ?? null;
  // Address-based search so a listing without coordinates still lands on
  // the right place (the title is a description and won't geocode).
  const mapQuery =
    [property.location, property.sublocality, property.city, property.state]
      .filter(Boolean)
      .join(', ') || property.title;
  // Only offer maps when the property has an actual pinned location —
  // coordinates or a saved Google Maps link. A text-only address/city
  // (e.g. "Coorg") would just open a vague search, so we hide it.
  const hasMapLocation = Boolean(coords) || !!property.google_map_link;
  const ownerPhone = property.owner?.phone;
  const selectedContacts = (matchesQuery.data ?? [])
    .filter((match) => selectedMatchIds.includes(match.contact.id))
    .map((match) => match.contact);
  const primaryAction = propertyDetailPrimaryAction({
    selectedCount: selectedContacts.length,
    ownerPhone: Boolean(ownerPhone),
    hasMapLocation,
  });
  const area = isLand
    ? property.land_area
      ? `${property.land_area} ${property.land_area_unit || ''}`.trim()
      : null
    : property.area_sqft
      ? `${property.area_sqft} ${property.area_unit || 'sqft'}`
      : null;
  // Web parity: land area is its own spec whenever it isn't already what
  // the Area tile shows — a 2500 Sq.Ft. house on an 8000 Sq.Ft. plot
  // must surface both, not bury the plot in the description.
  const landArea =
    !isLand && !isApartment && property.area_sqft && property.land_area
      ? `${property.land_area} ${property.land_area_unit || 'Sq.Ft.'}`
      : null;
  // Web parity (view mode): dimensions "F x D" splits into frontage/depth.
  const dimParts = (property.dimensions ?? '').includes('x')
    ? (property.dimensions ?? '').split('x').map((d) => d.trim())
    : [];
  const frontage = dimParts.length === 2 ? dimParts[0] : null;
  const depth = dimParts.length === 2 ? dimParts[1] : null;
  // Web parity: specs without a value are hidden, not dashed out.
  const specs = [
    showBedsBaths && property.bedrooms
      ? {
          icon: 'bed-outline' as const,
          label: 'Bedrooms',
          value: String(property.bedrooms),
        }
      : null,
    showBedsBaths && property.bathrooms
      ? {
          icon: 'water-outline' as const,
          label: 'Bathrooms',
          value: String(property.bathrooms),
        }
      : null,
    hasTotalFloors(propertyType) && property.total_floors
      ? {
          icon: 'layers-outline' as const,
          label: 'Total floors',
          value: String(property.total_floors),
        }
      : null,
    property.sublocality
      ? {
          icon: 'location-outline' as const,
          label: 'Locality',
          value: property.sublocality,
        }
      : null,
    area
      ? { icon: 'resize-outline' as const, label: 'Area', value: area }
      : null,
    landArea
      ? { icon: 'map-outline' as const, label: 'Land Area', value: landArea }
      : null,
    property.facing_direction
      ? {
          icon: 'compass-outline' as const,
          label: 'Facing',
          value: property.facing_direction,
        }
      : null,
    !isApartment && frontage
      ? {
          icon: 'swap-horizontal-outline' as const,
          label: 'Frontage',
          value: `${frontage} ft`,
        }
      : null,
    isLand && property.ownership_status
      ? {
          icon: 'ribbon-outline' as const,
          label: 'Ownership',
          value: property.ownership_status,
        }
      : null,
    isLand && property.conversion_type
      ? {
          icon: 'checkmark-circle-outline' as const,
          label: 'Conversion',
          value: property.conversion_type,
        }
      : null,
  ].filter((sp): sp is NonNullable<typeof sp> => sp !== null);
  const rentalIncome =
    typeof property.rental_income === 'number' && property.rental_income > 0
      ? property.rental_income
      : null;
  const yieldPct = rentalYieldPercent(
    property.listing_type,
    property.price,
    rentalIncome
  );
  // Web parity: "Listing Metadata" key/value rows, all conditional.
  const metadata = [
    !isLand && property.super_built_area
      ? {
          label: 'Super Built Area',
          value: `${property.super_built_area.toLocaleString('en-IN')} Sq.Ft.`,
        }
      : null,
    !isApartment && property.dimensions
      ? { label: 'Dimensions', value: property.dimensions }
      : null,
    !isApartment && frontage ? { label: 'Frontage', value: `${frontage} Feet` } : null,
    !isApartment && depth ? { label: 'Depth', value: `${depth} Feet` } : null,
    !isApartment && property.road_width
      ? {
          label: 'Road Width',
          value: `${property.road_width} ${property.road_width_unit || 'Feet'}`,
        }
      : null,
    (isLand || showCommercialBuildingFields) && property.land_zone
      ? { label: 'Land Zone', value: property.land_zone }
      : null,
    showCommercialBuildingFields && property.ideal_for
      ? { label: 'Ideal For', value: property.ideal_for }
      : null,
    showCommercialBuildingFields && rentalIncome
      ? {
          label: 'Rental Income',
          value: `${formatInr(rentalIncome)}/mo${yieldPct ? ` · ${yieldPct}% yield` : ''}`,
        }
      : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <View testID="property-detail-screen" style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingBottom: BOTTOM_BAR_CLEARANCE + insets.bottom,
        }}
      >
        <Stack.Screen
          options={{
            headerShown: true,
            title: property.property_code || 'Property',
          }}
        />

        {photos.length ? (
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
              {photos.map((source, i) => (
                <Pressable
                  key={i}
                  onPress={() => setViewerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`View photo ${i + 1} full screen`}
                >
                  <Image
                    source={source}
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
                {activeImage + 1}/{photos.length}
              </Text>
            </Pressable>
            {photos.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.thumbStrip}
                contentContainerStyle={{ gap: 8 }}
              >
                {photos.slice(0, 8).map((source, i) => (
                  <Pressable
                    key={i}
                    onPress={() => {
                      setActiveImage(i);
                      pagerRef.current?.scrollTo({
                        x: i * winW,
                        animated: true,
                      });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
                  >
                    <Image
                      source={source}
                      style={[
                        styles.thumb,
                        i === activeImage && {
                          borderColor: '#fff',
                          borderWidth: 2,
                        },
                      ]}
                    />
                  </Pressable>
                ))}
                {photos.length > 8 ? (
                  <Pressable
                    onPress={() => setViewerOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`View all ${photos.length} photos`}
                    style={[styles.thumb, styles.thumbMore]}
                  >
                    <Text style={styles.thumbMoreText}>
                      +{photos.length - 8}
                    </Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            ) : null}
            {viewerOpen ? (
              <GalleryViewer
                images={photos}
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
              gap: 8,
              backgroundColor: colors.primarySoft,
            }}
          >
            <Ionicons
              name={
                (property.private_images_count ?? 0) > 0
                  ? 'lock-closed-outline'
                  : 'home-outline'
              }
              size={40}
              color={colors.primary}
            />
            {(property.private_images_count ?? 0) > 0 ? (
              <Text style={{ fontSize: 12.5, color: colors.primary }}>
                {emptyPhotoLabel(property)}
              </Text>
            ) : null}
          </View>
        )}

        {/* Content sheet overlaps the hero photo (reference pattern). */}
        <View style={[styles.body, { backgroundColor: colors.background }]}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {property.listing_type ? (
              <Tag label={property.listing_type} />
            ) : null}
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

          <Text
            style={[
              styles.title,
              { color: colors.text, fontFamily: f.extrabold },
            ]}
          >
            {property.title}
          </Text>
          {place ? (
            <Text style={{ fontSize: 13.5, color: colors.textMuted }}>
              {place}
            </Text>
          ) : null}
          <Text
            style={{
              fontSize: 24,
              fontFamily: f.extrabold,
              color: colors.primary,
            }}
          >
            {price.value}
          </Text>
          {price.note ? (
            <Text
              style={{ fontSize: 12.5, color: colors.success, marginTop: -6 }}
            >
              {price.note}
            </Text>
          ) : null}

          <ActionRail property={property} />

          {specs.length > 0 ? (
            <View style={styles.specGrid}>
              {specs.map((sp) => (
                <Spec
                  key={sp.label}
                  icon={sp.icon}
                  label={sp.label}
                  value={sp.value}
                />
              ))}
            </View>
          ) : null}

          {property.description ? (
            <Section title="Description">
              <Text
                style={{
                  fontSize: 14,
                  lineHeight: 21,
                  color: colors.textMuted,
                }}
              >
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
                  {
                    backgroundColor: colors.glass,
                    borderColor: colors.glassBorder,
                  },
                ]}
              >
                {metadata.map((row, i) => (
                  <View
                    key={row.label}
                    style={[
                      styles.metaRow,
                      i > 0 && {
                        borderTopWidth: 1,
                        borderTopColor: colors.glassBorder,
                      },
                    ]}
                  >
                    <Text style={{ fontSize: 13, color: colors.textMuted }}>
                      {row.label}
                    </Text>
                    <Text
                      style={{
                        fontSize: 13.5,
                        fontFamily: f.bold,
                        color: colors.text,
                        flexShrink: 1,
                      }}
                      numberOfLines={2}
                    >
                      {row.value}
                    </Text>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}

          {plansWithImages(property.floor_plans).length ? (
            <Section title={isLand ? 'Land Sketches' : 'Floor Plans'}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.sm }}
              >
                {plansWithImages(property.floor_plans).map((fp, i) => (
                  <View
                    key={i}
                    style={[
                      styles.planCard,
                      { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                    ]}
                  >
                    <Image
                      source={{ uri: storagePublicUrl(fp.image!) }}
                      style={styles.planImg}
                      resizeMode="contain"
                    />
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 12, fontFamily: f.bold, color: colors.text }}
                    >
                      {fp.floor || `${isLand ? 'Sketch' : 'Floor'} ${i + 1}`}
                    </Text>
                    {fp.area_sqft || fp.notes ? (
                      <Text
                        numberOfLines={1}
                        style={{ fontSize: 11, fontFamily: f.regular, color: colors.textMuted }}
                      >
                        {[
                          fp.area_sqft ? `${fp.area_sqft.toLocaleString('en-IN')} Sq.Ft.` : '',
                          fp.notes,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
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
                      {
                        backgroundColor: colors.glass,
                        borderColor: colors.glassBorder,
                      },
                    ]}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        gap: spacing.sm,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          fontFamily: f.bold,
                          color: colors.text,
                          flex: 1,
                        }}
                      >
                        {ft.floor || `Unit ${i + 1}`}
                        {ft.tenant_name ? ` · ${ft.tenant_name}` : ''}
                      </Text>
                      {ft.monthly_rent ? (
                        <Text
                          style={{
                            fontSize: 13.5,
                            fontFamily: f.extrabold,
                            color: colors.primary,
                          }}
                        >
                          {formatInr(Number(ft.monthly_rent))}/mo
                        </Text>
                      ) : null}
                    </View>
                    <Text style={{ fontSize: 12, color: colors.textMuted }}>
                      {[
                        ft.area_sqft ? `${ft.area_sqft} Sq.Ft.` : null,
                        ft.advance
                          ? `Advance ${formatInr(Number(ft.advance))}`
                          : null,
                        ft.lease_start || ft.lease_end
                          ? `Lease ${ft.lease_start ?? '…'} → ${ft.lease_end ?? '…'}`
                          : null,
                        ft.lock_in_months
                          ? `Lock-in ${ft.lock_in_months} mo`
                          : null,
                        ft.maintenance ? `Maint: ${ft.maintenance}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {ft.notes ? (
                      <Text style={{ fontSize: 12, color: colors.textFaint }}>
                        {ft.notes}
                      </Text>
                    ) : null}
                  </View>
                ))}

                {/* Consolidated across every tenancy — web parity. Shown
                  only for the figures the rent roll actually records. */}
                {(() => {
                  const rentTotal = property.floor_tenancies!.reduce(
                    (sum, ft) => sum + (Number(ft.monthly_rent) || 0),
                    0
                  );
                  const advTotal = property.floor_tenancies!.reduce(
                    (sum, ft) => sum + (Number(ft.advance) || 0),
                    0
                  );
                  if (rentTotal <= 0 && advTotal <= 0) return null;
                  return (
                    <View
                      style={[
                        styles.tenancyCard,
                        {
                          backgroundColor: colors.primarySoft,
                          borderColor: colors.primary,
                        },
                      ]}
                    >
                      {rentTotal > 0 ? (
                        <View
                          style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12.5,
                              fontFamily: f.semibold,
                              color: colors.text,
                            }}
                          >
                            Total monthly rent
                          </Text>
                          <Text
                            style={{
                              fontSize: 13,
                              fontFamily: f.extrabold,
                              color: colors.primary,
                            }}
                          >
                            {formatInr(rentTotal)}
                          </Text>
                        </View>
                      ) : null}
                      {advTotal > 0 ? (
                        <View
                          style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12.5,
                              fontFamily: f.semibold,
                              color: colors.text,
                            }}
                          >
                            Total advance
                            {rentTotal > 0
                              ? ` (${(advTotal / rentTotal).toFixed(1)}× rent)`
                              : ''}
                          </Text>
                          <Text
                            style={{
                              fontSize: 13,
                              fontFamily: f.extrabold,
                              color: colors.primary,
                            }}
                          >
                            {formatInr(advTotal)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })()}
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
            <Section title="Internal Notes · Engine only">
              <View
                style={[
                  styles.notesCard,
                  {
                    backgroundColor: colors.warningSoft,
                    borderColor: colors.warning,
                  },
                ]}
              >
                <Text
                  style={{ fontSize: 13.5, lineHeight: 20, color: colors.text }}
                >
                  {property.notes}
                </Text>
              </View>
            </Section>
          ) : null}

          {property.owner ? (
            <Section
              title={property.listing_source === 'agent' ? 'Agent' : 'Owner'}
            >
              <Link
                href={`/(app)/contact/${property.owner_contact_id}`}
                asChild
              >
                {/* Slot child requires one flat style object (no arrays). */}
                <Pressable
                  style={StyleSheet.flatten([
                    styles.ownerRow,
                    {
                      backgroundColor: colors.glass,
                      borderColor: colors.glassBorder,
                    },
                  ])}
                >
                  <Ionicons
                    name="person-circle-outline"
                    size={22}
                    color={colors.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 14.5,
                        fontFamily: f.bold,
                        color: colors.text,
                      }}
                    >
                      {property.owner.name || property.owner.phone}
                    </Text>
                    {property.owner.name ? (
                      <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                        {property.owner.phone}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.textFaint}
                  />
                </Pressable>
              </Link>
            </Section>
          ) : null}

          <MatchesSection
            matches={matchesQuery.data ?? []}
            isLoading={matchesQuery.isLoading}
            isError={matchesQuery.isError}
            selectedIds={selectedMatchIds}
            setSelectedIds={setSelectedMatchIds}
            onShare={setShareTo}
          />

          {coords ? (
            <Section title="Location">
              {!nativeMapsAvailable ? (
                <Pressable
                  onPress={() =>
                    openInMaps({
                      latitude: coords.latitude,
                      longitude: coords.longitude,
                      label: mapQuery,
                      fallbackUrl: pin?.mapUrl,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Open location in Google Maps"
                  style={[
                    styles.mapFallbackRow,
                    {
                      backgroundColor: colors.glass,
                      borderColor: colors.glassBorder,
                    },
                  ]}
                >
                  <Ionicons name="location" size={18} color={colors.primary} />
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 14,
                      fontFamily: f.semibold,
                      color: colors.text,
                    }}
                  >
                    View location in Google Maps
                  </Text>
                  <Ionicons
                    name="open-outline"
                    size={16}
                    color={colors.textFaint}
                  />
                </Pressable>
              ) : (
                <View style={styles.mapWrap}>
                  <MapView
                    style={StyleSheet.absoluteFill}
                    initialRegion={{
                      latitude: coords.latitude,
                      longitude: coords.longitude,
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
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                        label: mapQuery,
                        fallbackUrl: pin?.mapUrl,
                      })
                    }
                  >
                    <Marker
                      coordinate={{
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                      }}
                      pinColor={colors.primary}
                    />
                  </MapView>
                </View>
              )}
            </Section>
          ) : null}

          {/* Only when the owner CTA isn't already the maps button and there's
            no inline map above — keeps a single "open maps" entry point. */}
          {ownerPhone && !coords && property.google_map_link ? (
            <Pressable
              style={[
                styles.mapButton,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
              onPress={() =>
                // This branch only renders when there are no coordinates
                // at all, so the saved link is the whole pin.
                openInMaps({ label: mapQuery, fallbackUrl: pin?.mapUrl })
              }
            >
              <Ionicons name="map-outline" size={17} color={colors.primary} />
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: f.semibold,
                  color: colors.primary,
                }}
              >
                Open in Google Maps
              </Text>
            </Pressable>
          ) : null}

          <PropertyDocuments
            propertyId={property.id}
            documents={property.documents ?? []}
            canEdit={canEdit}
            onChanged={() => {
              void queryClient.invalidateQueries({
                queryKey: ['property', property.id],
              });
            }}
          />

          <Text
            style={{
              fontSize: 12,
              color: colors.textFaint,
              textAlign: 'center',
            }}
          >
            AI descriptions, buyer document requests and the full sharing flows
            live on the web for now.
          </Text>
        </View>
      </ScrollView>

      {/* Sticky price + CTA bar (reference pattern). */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: blurredSurfaceColor(colors.surfaceWell),
            borderColor: colors.glassBorder,
            paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm,
          },
        ]}
      >
        <BlurView
          intensity={16}
          tint={glassBlurTint(dark)}
          blurMethod="none"
          style={StyleSheet.absoluteFill}
        />
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 11,
              fontFamily: f.bold,
              color: colors.textFaint,
              letterSpacing: 0.5,
            }}
          >
            {price.label}
          </Text>
          <Text
            style={{
              fontSize: 21,
              fontFamily: f.extrabold,
              color: colors.text,
              letterSpacing: -0.5,
            }}
          >
            {price.value}
          </Text>
        </View>
        {primaryAction ? (
          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={() => {
              if (primaryAction.kind === 'share') {
                haptic.tap();
                setShareTo(selectedContacts);
                return;
              }
              if (primaryAction.kind === 'whatsapp' && ownerPhone) {
                void Linking.openURL(
                  `https://wa.me/${ownerPhone.replace(/\D/g, '')}`
                );
                return;
              }
              void openInMaps({
                latitude: coords?.latitude,
                longitude: coords?.longitude,
                label: mapQuery,
                fallbackUrl: pin?.mapUrl,
              });
            }}
            accessibilityRole="button"
            accessibilityLabel={primaryAction.label}
          >
            <Ionicons
              name={primaryAction.icon}
              size={17}
              color={colors.onPrimary}
            />
            <Text
              style={{
                color: colors.onPrimary,
                fontSize: 15,
                fontFamily: f.bold,
              }}
            >
              {primaryAction.label}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <PropertyShareSheet
        property={property}
        contacts={shareTo ?? undefined}
        visible={shareTo !== null}
        onClose={() => setShareTo(null)}
        onShared={(ids) => {
          setSelectedMatchIds((prev) =>
            prev.filter((contactId) => !ids.includes(contactId))
          );
          void queryClient.invalidateQueries({
            queryKey: ['property-matches', property.id],
          });
        }}
      />
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
  const { show, close, dialogProps } = useAppDialog();

  function confirmArchive() {
    show({
      title: archived ? 'Unarchive this property?' : 'Archive this property?',
      message: archived
        ? 'It becomes Available and shows in searches again.'
        : 'Archived listings are hidden from searches and the showcase.',
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: archived ? 'Unarchive' : 'Archive',
          variant: 'primary',
          onPress: () => {
            close();
            doArchive();
          },
        },
      ],
    });
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
      show({
        title: 'Could not update',
        message: friendlyError(
          e instanceof ApiError ? e.message : 'Try again.'
        ),
      });
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    show({
      title: 'Delete this property?',
      message:
        'This permanently removes the listing, its photos and inquiry history. This cannot be undone.',
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: () => {
            close();
            doDelete();
          },
        },
      ],
    });
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
      show({
        title: 'Could not delete',
        message: friendlyError(
          e instanceof ApiError ? e.message : 'Try again.'
        ),
      });
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
    {
      key: 'delete',
      icon: 'trash-outline' as const,
      label: 'Delete',
      onPress: confirmDelete,
      danger: true,
    },
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
            <Text style={{ fontSize: 12.5, fontFamily: f.bold, color: fg }}>
              {a.label}
            </Text>
          </Pressable>
        );
      })}
      <AppDialog {...dialogProps} />
    </View>
  );
}

function chipColor(tone: MatchChipTone, colors: ThemeColors): string {
  if (tone === 'type') return colors.primary;
  if (tone === 'location') return colors.readTick;
  if (tone === 'positive') return colors.success;
  if (tone === 'warn') return colors.warning;
  if (tone === 'negative') return colors.danger;
  return colors.textFaint;
}

/**
 * Web parity: the Matching Contacts tab of the property dialog. The
 * audience filter (Buyers / Agents / All) picks who the list offers —
 * buyers by default, agents alone for a co-broker blast — ranked by the
 * same server-side engine, so a listing scores identically on both
 * surfaces.
 */
function MatchesSection({
  matches,
  isLoading,
  isError,
  selectedIds,
  setSelectedIds,
  onShare,
}: {
  matches: PropertyMatch[];
  isLoading: boolean;
  isError: boolean;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  onShare: (contacts: Contact[]) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [audience, setAudience] = useState<MatchAudience>('buyers');
  const [searchQuery, setSearchQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [audiencePickerOpen, setAudiencePickerOpen] = useState(false);
  const [audienceBusyId, setAudienceBusyId] = useState<string | null>(null);
  // Survives the action that created it: a silent bulk selection is
  // the one thing that could put a listing in front of the wrong 22
  // people, so what was added stays on screen — count, source listing,
  // and a way to undo exactly it.
  const [appliedAudience, setAppliedAudience] = useState<{
    listing: AudienceListing;
    ids: string[];
    unreachable: number;
  } | null>(null);
  const { show, dialogProps } = useAppDialog();

  const all = matches;
  const agentCount = all.filter(
    (m) => m.contact.classification === 'Agent'
  ).length;
  const buyerCount = all.length - agentCount;
  const audienceRows = all.filter((m) =>
    inMatchAudience(m.contact.classification, audience)
  );
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const rows = audienceRows.filter((m) => {
    if (!normalizedQuery) return true;
    return [
      m.contact.name,
      m.contact.phone,
      m.contact.classification,
      m.contact.name_tag,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
  });
  const sharedCount = audienceRows.filter((m) => m.sharedAt).length;
  const allSelected =
    rows.length > 0 && rows.every((m) => selectedIds.includes(m.contact.id));
  const selectedCount = all.filter((m) =>
    selectedIds.includes(m.contact.id)
  ).length;
  function toggle(id: string) {
    haptic.tap();
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // One tap: everyone who engaged with another listing. Matching
  // answers who fits this property; this answers who already asked
  // about a comparable one. Lands on the All tab because an audience
  // spans buyers and agents, and a pick hidden by the active filter
  // would look like nothing happened.
  async function applyListingAudience(listing: AudienceListing) {
    setAudienceBusyId(listing.propertyId);
    try {
      const members = await fetchListingAudience(listing.propertyId);
      const { ids, unreachable } = reachableAudienceIds(
        members,
        all.map((m) => m.contact)
      );
      if (ids.length === 0) {
        show({
          title: 'Nobody to select',
          message: `No one in ${audienceListingLabel(listing)}'s audience can be messaged on WhatsApp from here.`,
        });
        return;
      }
      setSelectedIds((prev) => [...new Set([...prev, ...ids])]);
      setAppliedAudience({ listing, ids, unreachable });
      setAudience('all');
      setExpanded(true);
      setAudiencePickerOpen(false);
    } catch (err) {
      show({
        title: 'Could not load that audience',
        message: friendlyError(
          err instanceof ApiError ? err.message : 'Try again.'
        ),
      });
    } finally {
      setAudienceBusyId(null);
    }
  }

  // Switching audience drops selections outside it, so "Select all"
  // then share never carries hidden picks from the previous tab.
  function switchAudience(next: MatchAudience) {
    haptic.tap();
    setAudience(next);
    if (next === 'all') return;
    const visible = new Set(
      all
        .filter((m) => inMatchAudience(m.contact.classification, next))
        .map((m) => m.contact.id)
    );
    setSelectedIds((prev) => prev.filter((id) => visible.has(id)));
  }

  return (
    <Section title="Matching Contacts">
      <Pressable
        onPress={() => {
          haptic.tap();
          setExpanded((prev) => !prev);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={
          expanded ? 'Collapse matching contacts' : 'Expand matching contacts'
        }
        style={[
          styles.matchSummary,
          { backgroundColor: colors.primarySoft, borderColor: colors.primary },
        ]}
      >
        <View
          style={[styles.matchSummaryIcon, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="people" size={18} color={colors.onPrimary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{ fontSize: 14, fontFamily: f.bold, color: colors.text }}
          >
            {isLoading
              ? 'Finding the best contacts…'
              : `${audienceRows.length} ${audience === 'agents' ? 'agent' : audience === 'buyers' ? 'buyer' : 'contact'}${audienceRows.length === 1 ? '' : 's'} ranked`}
          </Text>
          <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
            {isError
              ? 'Could not load matches — pull to refresh.'
              : expanded
                ? `${sharedCount} already shared · Select contacts to share together`
                : `${sharedCount} already shared · Tap to open the list`}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.primary}
        />
      </Pressable>

      {/* Also shown while a non-default audience is active with no
        agents left, so a refetch can never strand the section on an
        empty tab with no way back. */}
      {expanded && (agentCount > 0 || audience !== 'buyers') ? (
        <View
          style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}
        >
          <FilterChip
            label={`Buyers ${buyerCount}`}
            active={audience === 'buyers'}
            onPress={() => switchAudience('buyers')}
          />
          <FilterChip
            label={`Agents ${agentCount}`}
            active={audience === 'agents'}
            onPress={() => switchAudience('agents')}
          />
          <FilterChip
            label={`All ${all.length}`}
            active={audience === 'all'}
            onPress={() => switchAudience('all')}
          />
        </View>
      ) : null}

      {expanded && appliedAudience ? (
        <View
          style={[
            styles.audienceBanner,
            { backgroundColor: colors.primarySoft, borderColor: colors.primary },
          ]}
        >
          <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 13, fontFamily: f.bold, color: colors.text }}>
              {appliedAudience.ids.length} contact
              {appliedAudience.ids.length === 1 ? '' : 's'} from{' '}
              {audienceListingLabel(appliedAudience.listing)} selected
            </Text>
            <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.textMuted }}>
              Everyone who enquired about or viewed that listing is ticked below.
              {appliedAudience.unreachable > 0
                ? ` ${appliedAudience.unreachable} skipped — no WhatsApp number.`
                : ''}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              haptic.tap();
              const removed = new Set(appliedAudience.ids);
              setSelectedIds((prev) => prev.filter((id) => !removed.has(id)));
              setAppliedAudience(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Undo the listing audience selection"
            hitSlop={8}
          >
            <Text style={{ fontSize: 11.5, fontFamily: f.bold, color: colors.primary }}>
              Undo
            </Text>
          </Pressable>
        </View>
      ) : null}

      {expanded ? (
        <Pressable
          onPress={() => {
            haptic.tap();
            setAudiencePickerOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Share with a listing's audience"
          style={[
            styles.audienceCta,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
          ]}
        >
          <Ionicons name="people-circle-outline" size={18} color={colors.primary} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ fontSize: 13, fontFamily: f.bold, color: colors.text }}>
              Share with a listing&apos;s audience
            </Text>
            <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
              Everyone who enquired about or viewed another listing
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </Pressable>
      ) : null}

      {expanded && (audienceRows.length > 5 || searchQuery) ? (
        <View
          style={[
            styles.matchSearch,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
          ]}
        >
          <Ionicons name="search" size={17} color={colors.textFaint} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search name or phone"
            placeholderTextColor={colors.textFaint}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search matching contacts"
            style={{ flex: 1, fontSize: 13.5, color: colors.text }}
          />
          {searchQuery ? (
            <Pressable
              onPress={() => setSearchQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear contact search"
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.textFaint}
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {expanded && rows.length > 0 ? (
        <View style={styles.matchSelectionBar}>
          <Text style={{ flex: 1, fontSize: 12, color: colors.textMuted }}>
            {selectedCount > 0
              ? `${selectedCount} selected`
              : `${rows.length} shown${normalizedQuery ? ` for “${searchQuery.trim()}”` : ''} · tap to select`}
          </Text>
          <Pressable
            onPress={() => {
              haptic.tap();
              setSelectedIds((current) => {
                const visibleIds = rows.map((m) => m.contact.id);
                return allSelected
                  ? current.filter((id) => !visibleIds.includes(id))
                  : [...new Set([...current, ...visibleIds])];
              });
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              allSelected
                ? 'Clear visible selection'
                : `Select all ${rows.length} visible contacts`
            }
          >
            <Text
              style={{
                fontSize: 12,
                fontFamily: f.bold,
                color: colors.primary,
              }}
            >
              {allSelected ? 'Deselect shown' : `Select shown (${rows.length})`}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {expanded && isLoading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : null}

      {expanded && !isLoading && rows.length === 0 ? (
        <View
          style={[
            styles.matchEmpty,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
          ]}
        >
          <Ionicons name="search-outline" size={22} color={colors.textFaint} />
          <Text
            style={{ fontSize: 13, fontFamily: f.semibold, color: colors.text }}
          >
            {normalizedQuery
              ? 'No contacts match this search'
              : 'No matching contacts yet'}
          </Text>
          <Text
            style={{
              fontSize: 11.5,
              color: colors.textMuted,
              textAlign: 'center',
            }}
          >
            {normalizedQuery
              ? 'Try a different name or phone number.'
              : 'Add budget, location and property preferences to improve matching.'}
          </Text>
        </View>
      ) : null}

      {expanded && rows.length > 0 ? (
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          style={styles.matchList}
          contentContainerStyle={{ gap: spacing.sm }}
        >
          {rows.map((m) => {
            // Already shared: the row recedes and says so, so an agent
            // working down the list can see who still needs the message
            // without re-sending to someone who already has it. Sharing
            // again stays available — it is a reminder, not a lockout.
            const shared = Boolean(m.sharedAt);
            const displayName =
              m.contact.name || m.contact.phone || 'Unnamed contact';
            return (
              <MatchTargetRow
                key={m.contact.id}
                name={displayName}
                detail={m.contact.phone}
                inquiries={m.inquiries.map(inquiredPropertyLabel)}
                scoreLabel={`${m.score}%`}
                scoreCaption="match"
                tone={scoreTone(m.score)}
                chips={[
                  ...(shared
                    ? [
                        {
                          label: `✓ Shared ${chatListTime(m.sharedAt!)}`,
                          color: colors.success,
                        },
                      ]
                    : []),
                  ...matchChips(m.details).map((chip) => ({
                    label: chip.label,
                    color: chipColor(chip.tone, colors),
                  })),
                ]}
                badges={
                  <>
                    {m.contact.name_tag ? (
                      <View style={nameTagCap}>
                        <Tag label={m.contact.name_tag} />
                      </View>
                    ) : null}
                    {m.contact.classification ? (
                      <Tag
                        label={m.contact.classification}
                        color={
                          m.contact.classification === 'Agent'
                            ? colors.readTick
                            : colors.success
                        }
                      />
                    ) : null}
                  </>
                }
                indicator="avatar"
                initials={displayName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join('')
                  .toLocaleUpperCase()}
                dimmed={shared}
                selected={selectedIds.includes(m.contact.id)}
                onToggle={() => toggle(m.contact.id)}
                footer={
                  <>
                    <Pressable
                      onPress={() =>
                        router.push(`/(app)/contact/${m.contact.id}`)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`View ${displayName} contact`}
                      style={styles.matchAction}
                    >
                      <Ionicons
                        name="person-outline"
                        size={15}
                        color={colors.textMuted}
                      />
                      <Text
                        style={{
                          fontSize: 11.5,
                          fontFamily: f.semibold,
                          color: colors.textMuted,
                        }}
                      >
                        View contact
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        haptic.tap();
                        onShare([m.contact]);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        shared
                          ? `Share again with ${displayName}`
                          : `Share property with ${displayName}`
                      }
                      style={[
                        styles.matchAction,
                        styles.matchShareAction,
                        { backgroundColor: colors.primarySoft },
                      ]}
                    >
                      <Ionicons
                        name={shared ? 'refresh-outline' : 'paper-plane-outline'}
                        size={15}
                        color={colors.primary}
                      />
                      <Text
                        style={{
                          fontSize: 11.5,
                          fontFamily: f.bold,
                          color: colors.primary,
                        }}
                      >
                        {shared ? 'Share again' : 'Share property'}
                      </Text>
                    </Pressable>
                  </>
                }
              />
            );
          })}
        </ScrollView>
      ) : null}

      <ListingAudienceSheet
        visible={audiencePickerOpen}
        onClose={() => setAudiencePickerOpen(false)}
        onPick={applyListingAudience}
        busyId={audienceBusyId}
      />

      <AppDialog {...dialogProps} />
    </Section>
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
  images: ImageSourcePropType[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);

  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({
            length: width,
            offset: width * i,
            index: i,
          })}
          keyExtractor={(_, i) => String(i)}
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
                source={item}
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
    <View
      style={[
        styles.spec,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={{ fontSize: 11, color: colors.textFaint }}>{label}</Text>
      <Text style={{ fontSize: 13.5, fontFamily: f.bold, color: colors.text }}>
        {value}
      </Text>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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
  // Wrapping, not one squeezed row: with Land Area a listing can carry
  // five-plus specs, and flex: 1 tiles in a no-wrap row crush each other
  // until the values truncate. minWidth caps phones at ~3 per row.
  specGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  spec: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 96,
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
  planCard: {
    width: 160,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 4,
  },
  planImg: {
    width: '100%',
    height: 110,
    borderRadius: radius.sm,
    backgroundColor: '#fff',
  },
  notesCard: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  matchSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  // The matched list is a section of a long screen, not the screen: it
  // scrolls inside its own box so dozens of ranked contacts cannot bury
  // the price, map and documents below it.
  matchList: { maxHeight: 420 },
  matchSummaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchSearch: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  matchSelectionBar: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 2,
  },
  matchEmpty: {
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
  },
  matchAction: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
  matchShareAction: {
    paddingHorizontal: spacing.md,
  },
  audienceBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  audienceCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
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
