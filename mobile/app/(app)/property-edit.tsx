import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { ConvoRealLoader } from '@/components/loader';
import { OptionSheet } from '@/components/option-sheet';
import { PropertyPhotoEditor } from '@/components/property-photo-editor';
import { Banner, FilterChip, PrimaryButton, SectionLabel, TextField } from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import {
  AMENITIES_BY_CATEGORY,
  AREA_UNITS,
  FACING_DIRECTIONS,
  LISTING_TYPES,
  NEARBY_HIGHLIGHTS_OPTIONS,
  PROPERTY_TYPE_GROUPS,
} from '@/lib/property-options';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Property } from '@/lib/types';

const STATUSES = ['Available', 'Under Contract', 'Sold', 'Off Market', 'Archived'] as const;

async function fetchProperty(id: string): Promise<Property | null> {
  const { data, error } = await supabase
    .from('properties')
    .select(
      'id, title, description, price, rent_per_month, maintenance, status, listing_type, ' +
        'bedrooms, bathrooms, area_sqft, area_unit, is_published, type, images, ' +
        'location, sublocality, city, state, land_area, land_area_unit, super_built_area, ' +
        'dimensions, facing_direction, google_map_link, features, nearby_highlights'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Property | null;
}

/**
 * Property editor — mirrors the web form's common fields: photos, type,
 * listing type, price/rent, status, specs, land & dimensions, location,
 * features, nearby highlights, description and publish. Saves through the
 * same PUT /api/properties/[id]. Documents, floor tenancies and deal
 * terms remain on the web's full form.
 */
export default function PropertyEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: property, isLoading } = useQuery({
    queryKey: ['property-edit', id],
    queryFn: () => fetchProperty(id),
    enabled: Boolean(id),
  });

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Edit property' }} />
      {isLoading || !property ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ConvoRealLoader />
        </View>
      ) : (
        <EditForm property={property} />
      )}
    </View>
  );
}

function EditForm({ property }: { property: Property }) {
  const { colors, fonts: f } = useTheme();

  const [images, setImages] = useState<string[]>(property.images ?? []);
  const [title, setTitle] = useState(property.title);
  const [type, setType] = useState(property.type ?? '');
  const [listingType, setListingType] = useState<string>(property.listing_type ?? 'Sale');
  const [price, setPrice] = useState(property.price ? String(property.price) : '');
  const [rent, setRent] = useState(property.rent_per_month ? String(property.rent_per_month) : '');
  const [maintenance, setMaintenance] = useState(
    property.maintenance ? String(property.maintenance) : ''
  );
  const [status, setStatus] = useState(property.status ?? 'Available');
  const [bedrooms, setBedrooms] = useState(property.bedrooms ? String(property.bedrooms) : '');
  const [bathrooms, setBathrooms] = useState(property.bathrooms ? String(property.bathrooms) : '');
  const [area, setArea] = useState(property.area_sqft ? String(property.area_sqft) : '');
  const areaUnit = property.area_unit || 'Sq.Ft.';
  const [landArea, setLandArea] = useState(property.land_area ? String(property.land_area) : '');
  const [landAreaUnit, setLandAreaUnit] = useState(property.land_area_unit || 'Sq.Ft.');
  const [superBuilt, setSuperBuilt] = useState(
    property.super_built_area ? String(property.super_built_area) : ''
  );
  const [dimensions, setDimensions] = useState(property.dimensions ?? '');
  const [facing, setFacing] = useState(property.facing_direction ?? '');
  const [location, setLocation] = useState(property.location ?? '');
  const [sublocality, setSublocality] = useState(property.sublocality ?? '');
  const [city, setCity] = useState(property.city ?? '');
  const [stateVal, setStateVal] = useState(property.state ?? '');
  const [mapLink, setMapLink] = useState(property.google_map_link ?? '');
  const [features, setFeatures] = useState<string[]>(property.features ?? []);
  const [nearby, setNearby] = useState<string[]>(property.nearby_highlights ?? []);
  const [description, setDescription] = useState(property.description ?? '');
  const [published, setPublished] = useState(Boolean(property.is_published));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<'type' | 'features' | 'nearby' | null>(null);

  const isRent = listingType === 'Rent' || listingType === 'Built to Suit';

  useEffect(() => {
    setError(null);
  }, [title, price, rent, status]);

  function num(value: string): number | null {
    const n = Number(value.replace(/[^\d.]/g, ''));
    return value.trim() && Number.isFinite(n) ? n : null;
  }

  async function save() {
    if (!title.trim()) {
      setError('Give the listing a title.');
      return;
    }
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      title: title.trim(),
      status,
      type: type || null,
      listing_type: listingType,
      description: description.trim() || null,
      is_published: published,
      bedrooms: num(bedrooms),
      bathrooms: num(bathrooms),
      area_sqft: num(area),
      land_area: num(landArea),
      land_area_unit: landAreaUnit,
      super_built_area: num(superBuilt),
      dimensions: dimensions.trim() || null,
      facing_direction: facing || null,
      location: location.trim() || null,
      sublocality: sublocality.trim() || null,
      city: city.trim() || null,
      state: stateVal.trim() || null,
      google_map_link: mapLink.trim() || null,
      features,
      nearby_highlights: nearby,
      images,
    };
    if (isRent) {
      body.rent_per_month = num(rent);
      body.maintenance = num(maintenance);
    } else {
      const p = num(price);
      if (p !== null) body.price = p;
    }
    try {
      await apiFetch(`/api/properties/${property.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    } catch (e) {
      setSaving(false);
      haptic.warn();
      setError(friendlyError(e instanceof ApiError ? e.message : 'Could not save changes.'));
      return;
    }
    setSaving(false);
    haptic.success();
    queryClient.invalidateQueries({ queryKey: ['property', property.id] });
    queryClient.invalidateQueries({ queryKey: ['property-edit', property.id] });
    queryClient.invalidateQueries({ queryKey: ['properties'] });
    router.back();
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {error ? <Banner kind="error" text={error} /> : null}

        <PropertyPhotoEditor images={images} onChange={setImages} />

        <TextField label="Title" value={title} onChangeText={setTitle} />

        <SelectField
          label="Type"
          value={type}
          placeholder="Choose a property type"
          onPress={() => setSheet('type')}
        />

        <SectionLabel text="Listing type" />
        <View style={styles.chips}>
          {LISTING_TYPES.map((lt) => (
            <FilterChip
              key={lt.value}
              label={lt.label}
              active={listingType === lt.value}
              onPress={() => setListingType(lt.value)}
            />
          ))}
        </View>

        {isRent ? (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <TextField
                label="Rent / month (₹)"
                value={rent}
                onChangeText={setRent}
                keyboardType="numeric"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label="Maintenance (₹)"
                value={maintenance}
                onChangeText={setMaintenance}
                keyboardType="numeric"
              />
            </View>
          </View>
        ) : (
          <TextField label="Price (₹)" value={price} onChangeText={setPrice} keyboardType="numeric" />
        )}

        <SectionLabel text="Status" />
        <View style={styles.chips}>
          {STATUSES.map((s) => (
            <FilterChip key={s} label={s} active={status === s} onPress={() => setStatus(s)} />
          ))}
        </View>

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <TextField label="Bedrooms" value={bedrooms} onChangeText={setBedrooms} keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label="Bathrooms" value={bathrooms} onChangeText={setBathrooms} keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label={`Area (${areaUnit})`} value={area} onChangeText={setArea} keyboardType="numeric" />
          </View>
        </View>

        <SectionLabel text="Land & dimensions" />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <TextField label="Land area" value={landArea} onChangeText={setLandArea} keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label="Super built (sqft)" value={superBuilt} onChangeText={setSuperBuilt} keyboardType="numeric" />
          </View>
        </View>
        <View style={styles.chips}>
          {AREA_UNITS.map((u) => (
            <FilterChip key={u} label={u} active={landAreaUnit === u} onPress={() => setLandAreaUnit(u)} />
          ))}
        </View>
        <TextField label="Dimensions (e.g. 80x50)" value={dimensions} onChangeText={setDimensions} />
        <SectionLabel text="Facing" />
        <View style={styles.chips}>
          {FACING_DIRECTIONS.map((d) => (
            <FilterChip
              key={d}
              label={d}
              active={facing === d}
              onPress={() => setFacing(facing === d ? '' : d)}
            />
          ))}
        </View>

        <SectionLabel text="Location" />
        <TextField label="Address / area" value={location} onChangeText={setLocation} />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <TextField label="Locality" value={sublocality} onChangeText={setSublocality} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label="City" value={city} onChangeText={setCity} />
          </View>
        </View>
        <TextField label="State" value={stateVal} onChangeText={setStateVal} />
        <TextField
          label="Google Maps link"
          value={mapLink}
          onChangeText={setMapLink}
          autoCapitalize="none"
        />

        <SelectField
          label="Features"
          value={features.length ? `${features.length} selected` : ''}
          placeholder="Add amenities & features"
          onPress={() => setSheet('features')}
        />
        <SelectField
          label="Nearby highlights"
          value={nearby.length ? `${nearby.length} selected` : ''}
          placeholder="Metro, school, mall…"
          onPress={() => setSheet('nearby')}
        />

        <TextField label="Description" value={description} onChangeText={setDescription} multiline />

        <View style={styles.publishRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, fontFamily: f.bold, color: colors.text }}>
              Published on showcase
            </Text>
            <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
              Unpublished listings stay internal to ConvoReal.
            </Text>
          </View>
          <Switch
            value={published}
            onValueChange={setPublished}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor="#fff"
          />
        </View>

        <PrimaryButton label="Save changes" busy={saving} onPress={save} />
        <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}>
          Documents, floor tenancies and deal terms are still edited in the web app's full form.
        </Text>
      </ScrollView>

      <OptionSheet
        visible={sheet === 'type'}
        onClose={() => setSheet(null)}
        title="Property type"
        groups={PROPERTY_TYPE_GROUPS}
        selected={type ? [type] : []}
        onChange={(v) => setType(v[0] ?? '')}
      />
      <OptionSheet
        visible={sheet === 'features'}
        onClose={() => setSheet(null)}
        title="Features & amenities"
        multi
        groups={AMENITIES_BY_CATEGORY.map((c) => ({ group: c.category, options: c.items }))}
        selected={features}
        onChange={setFeatures}
      />
      <OptionSheet
        visible={sheet === 'nearby'}
        onClose={() => setSheet(null)}
        title="Nearby highlights"
        multi
        groups={[{ options: NEARBY_HIGHLIGHTS_OPTIONS }]}
        selected={nearby}
        onChange={setNearby}
      />
    </KeyboardAvoidingView>
  );
}

function SelectField({
  label,
  value,
  placeholder,
  onPress,
}: {
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <SectionLabel text={label} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.select, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text
          style={{
            flex: 1,
            fontSize: 15,
            fontFamily: f.medium,
            color: value ? colors.text : colors.textFaint,
          }}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textFaint} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  row: { flexDirection: 'row', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  publishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
});
