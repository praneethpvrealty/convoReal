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

import { ContactPickerSheet } from '@/components/contact-picker-sheet';
import { InlineDateTimePicker } from '@/components/datetime-field';
import { ConvoRealLoader } from '@/components/loader';
import { OptionSheet } from '@/components/option-sheet';
import { PropertyPhotoEditor } from '@/components/property-photo-editor';
import { Banner, FilterChip, PriceHint, PrimaryButton, SectionLabel, TextField } from '@/components/ui';
import { formatInr } from '@/lib/format';
import { apiFetch, ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import {
  AMENITIES_BY_CATEGORY,
  AREA_UNITS,
  COMMERCIAL_TYPES,
  FACING_DIRECTIONS,
  LISTING_TYPES,
  NEARBY_HIGHLIGHTS_OPTIONS,
  PROPERTY_TYPE_GROUPS,
} from '@/lib/property-options';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Property } from '@/lib/types';
// The row shape the server sanitizes into. Type-only, so nothing from
// the web lib reaches the bundle.
import type { FloorTenancy } from '@shared/lib/inventory/floor-tenancies';

const STATUSES = ['Available', 'Under Contract', 'Sold', 'Off Market', 'Archived'] as const;

// String drafts of lib/inventory/floor-tenancies rows (web parity).
interface TenancyDraft {
  floor: string;
  tenant_name: string;
  area_sqft: string;
  monthly_rent: string;
  advance: string;
  lease_start: string;
  lease_end: string;
  lock_in_months: string;
  maintenance: string;
  notes: string;
}

const emptyTenancy: TenancyDraft = {
  floor: '',
  tenant_name: '',
  area_sqft: '',
  monthly_rent: '',
  advance: '',
  lease_start: '',
  lease_end: '',
  lock_in_months: '',
  maintenance: '',
  notes: '',
};

function toIsoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

async function fetchProperty(id: string): Promise<Property | null> {
  const { data, error } = await supabase
    .from('properties')
    .select(
      'id, title, description, price, rent_per_month, maintenance, status, listing_type, sold_price, ' +
        'bedrooms, bathrooms, area_sqft, area_unit, is_published, type, images, ' +
        'location, sublocality, city, state, land_area, land_area_unit, super_built_area, ' +
        'dimensions, facing_direction, google_map_link, features, nearby_highlights, ' +
        'floor_tenancies, owner_contact_id, owner:contacts!properties_owner_contact_id_fkey(id, name, phone)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Property | null;
}

/**
 * Property editor — mirrors the web form's common fields: photos, type,
 * listing type, price/rent, status, specs, land & dimensions, location,
 * features, nearby highlights, floor-wise tenancy (rent roll) for
 * commercial types, description and publish. Saves through the same
 * PUT /api/properties/[id]. Documents and deal terms remain on the
 * web's full form.
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
  const [soldPrice, setSoldPrice] = useState(property.sold_price ? String(property.sold_price) : '');
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
  const [tenancies, setTenancies] = useState<TenancyDraft[]>(
    (property.floor_tenancies ?? []).map((ft) => ({
      floor: ft.floor ?? '',
      tenant_name: ft.tenant_name ?? '',
      area_sqft: ft.area_sqft != null ? String(ft.area_sqft) : '',
      monthly_rent: ft.monthly_rent != null ? String(ft.monthly_rent) : '',
      advance: ft.advance != null ? String(ft.advance) : '',
      lease_start: ft.lease_start ?? '',
      lease_end: ft.lease_end ?? '',
      lock_in_months: ft.lock_in_months != null ? String(ft.lock_in_months) : '',
      maintenance: ft.maintenance ?? '',
      notes: ft.notes ?? '',
    }))
  );
  const [description, setDescription] = useState(property.description ?? '');
  const [published, setPublished] = useState(Boolean(property.is_published));
  const [ownerContactId, setOwnerContactId] = useState<string | null>(
    property.owner_contact_id ?? null
  );
  const [ownerLabel, setOwnerLabel] = useState(
    property.owner?.name || property.owner?.phone || ''
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<'type' | 'features' | 'nearby' | 'owner' | null>(null);

  const isRent = listingType === 'Rent' || listingType === 'Built to Suit';
  const isCommercial = COMMERCIAL_TYPES.includes(type);

  useEffect(() => {
    setError(null);
  }, [title, price, rent, status]);

  function num(value: string): number | null {
    const n = Number(value.replace(/[^\d.]/g, ''));
    return value.trim() && Number.isFinite(n) ? n : null;
  }

  function updateTenancy(idx: number, key: keyof TenancyDraft, value: string) {
    setTenancies((prev) => prev.map((t, i) => (i === idx ? { ...t, [key]: value } : t)));
  }

  const tenancyTotal = tenancies.reduce((sum, t) => sum + (num(t.monthly_rent) ?? 0), 0);
  const advanceTotal = tenancies.reduce((sum, t) => sum + (num(t.advance) ?? 0), 0);

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
      owner_contact_id: ownerContactId,
      // Web parity: only meaningful while Sold; null clears a stale
      // value if the status moves away from Sold.
      sold_price: status === 'Sold' ? num(soldPrice) : null,
    };
    if (isRent) {
      body.rent_per_month = num(rent);
      body.maintenance = num(maintenance);
    } else {
      const p = num(price);
      if (p !== null) body.price = p;
    }
    // Only sent while the section is visible — switching to a
    // non-commercial type leaves the stored rent roll untouched.
    // Server-side sanitizeFloorTenancies() drops empty rows and
    // re-validates every value.
    if (isCommercial) {
      // Typed as the shared FloorTenancy so a column added on the web
      // cannot be quietly dropped here: its keys are required, so an
      // omission fails the build instead of PUTting the field back as
      // null over whatever the web had stored.
      const rentRoll: FloorTenancy[] = tenancies.map((t) => ({
        floor: t.floor.trim(),
        tenant_name: t.tenant_name.trim() || null,
        area_sqft: num(t.area_sqft),
        monthly_rent: num(t.monthly_rent),
        advance: num(t.advance),
        lease_start: t.lease_start || null,
        lease_end: t.lease_end || null,
        lock_in_months: num(t.lock_in_months),
        maintenance: t.maintenance.trim() || null,
        notes: t.notes.trim() || null,
      }));
      body.floor_tenancies = rentRoll;
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
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
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
            <View style={{ flex: 1, gap: 4 }}>
              <TextField
                label="Rent / month (₹)"
                value={rent}
                onChangeText={setRent}
                keyboardType="numeric"
              />
              <PriceHint value={rent} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <TextField
                label="Maintenance (₹)"
                value={maintenance}
                onChangeText={setMaintenance}
                keyboardType="numeric"
              />
              <PriceHint value={maintenance} />
            </View>
          </View>
        ) : (
          <View style={{ gap: 4 }}>
            <TextField label="Price (₹)" value={price} onChangeText={setPrice} keyboardType="numeric" />
            <PriceHint value={price} />
          </View>
        )}

        <SectionLabel text="Status" />
        <View style={styles.chips}>
          {STATUSES.map((s) => (
            <FilterChip key={s} label={s} active={status === s} onPress={() => setStatus(s)} />
          ))}
        </View>

        {status === 'Sold' ? (
          <View style={{ gap: 4 }}>
            <TextField
              label="Final sale price (₹)"
              value={soldPrice}
              onChangeText={setSoldPrice}
              keyboardType="numeric"
              placeholder={num(price) ? `e.g. ${num(price)}` : 'e.g. 8500000'}
            />
            <PriceHint value={soldPrice} />
            <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
              Optional — improves your area’s price accuracy. Never shown to buyers.
            </Text>
          </View>
        ) : null}

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
          label="Owner / Agent"
          value={ownerLabel}
          placeholder="Assign the owner or agent contact"
          onPress={() => setSheet('owner')}
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

        {isCommercial ? (
          <>
            <SectionLabel text="Floor-wise tenancy (Rent roll)" />
            <Text style={{ fontSize: 12.5, color: colors.textMuted, marginTop: -6 }}>
              For pre-leased buildings — tenant, rent (excluding GST), lease period, lock-in and
              maintenance per floor. Internal to your Engine; never shown on the showcase.
            </Text>
            {tenancies.map((t, i) => (
              <View
                key={i}
                style={[
                  styles.tenancyCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={styles.tenancyHeader}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: f.bold,
                      color: colors.textFaint,
                      letterSpacing: 0.8,
                      textTransform: 'uppercase',
                    }}
                  >
                    Floor / Unit {i + 1}
                  </Text>
                  <Pressable
                    onPress={() => setTenancies((prev) => prev.filter((_, idx) => idx !== i))}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove floor ${i + 1}`}
                  >
                    <Ionicons name="trash-outline" size={17} color={colors.danger} />
                  </Pressable>
                </View>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Floor / unit"
                      value={t.floor}
                      onChangeText={(v) => updateTenancy(i, 'floor', v)}
                      placeholder="e.g. 2nd + 3rd Floor"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Tenant"
                      value={t.tenant_name}
                      onChangeText={(v) => updateTenancy(i, 'tenant_name', v)}
                      placeholder="e.g. Ramada Hospitality"
                    />
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Area (Sq.Ft.)"
                      value={t.area_sqft}
                      onChangeText={(v) => updateTenancy(i, 'area_sqft', v)}
                      keyboardType="numeric"
                      placeholder="10000"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Rent (₹, excl. GST)"
                      value={t.monthly_rent}
                      onChangeText={(v) => updateTenancy(i, 'monthly_rent', v)}
                      keyboardType="numeric"
                      placeholder="1350000"
                    />
                    <PriceHint value={t.monthly_rent} />
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Advance / Deposit (₹)"
                      value={t.advance}
                      onChangeText={(v) => updateTenancy(i, 'advance', v)}
                      keyboardType="numeric"
                      placeholder="8100000"
                    />
                    <PriceHint value={t.advance} />
                  </View>
                </View>
                <View style={styles.row}>
                  <TenancyDateField
                    label="Lease start"
                    value={t.lease_start}
                    onChange={(v) => updateTenancy(i, 'lease_start', v)}
                  />
                  <TenancyDateField
                    label="Lease end"
                    value={t.lease_end}
                    onChange={(v) => updateTenancy(i, 'lease_end', v)}
                  />
                </View>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Lock-in (months)"
                      value={t.lock_in_months}
                      onChangeText={(v) => updateTenancy(i, 'lock_in_months', v)}
                      keyboardType="numeric"
                      placeholder="36"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Maintenance"
                      value={t.maintenance}
                      onChangeText={(v) => updateTenancy(i, 'maintenance', v)}
                      placeholder="e.g. ₹5/sqft, by tenant"
                    />
                  </View>
                </View>
                <TextField
                  label="Usage / notes"
                  value={t.notes}
                  onChangeText={(v) => updateTenancy(i, 'notes', v)}
                  placeholder="e.g. 3-Star Hotel · 27 rooms"
                />
              </View>
            ))}
            <Pressable
              onPress={() => {
                haptic.tap();
                setTenancies((prev) => [...prev, { ...emptyTenancy }]);
              }}
              accessibilityRole="button"
              accessibilityLabel="Add floor to rent roll"
              style={[styles.addFloorRow, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <Ionicons name="add" size={18} color={colors.primary} />
              <Text style={{ fontSize: 14, fontFamily: f.semibold, color: colors.primary }}>
                Add floor
              </Text>
            </Pressable>
            {tenancyTotal > 0 || advanceTotal > 0 ? (
              <View style={{ gap: 4 }}>
                {tenancyTotal > 0 ? (
                  <Text style={{ fontSize: 13, fontFamily: f.bold, color: colors.text }}>
                    Total monthly rent:{' '}
                    <Text style={{ color: colors.primary }}>{formatInr(tenancyTotal)}</Text>{' '}
                    <Text style={{ fontFamily: f.medium, color: colors.textMuted }}>
                      (excluding GST)
                    </Text>
                  </Text>
                ) : null}
                {advanceTotal > 0 ? (
                  <Text style={{ fontSize: 13, fontFamily: f.bold, color: colors.text }}>
                    Total advance:{' '}
                    <Text style={{ color: colors.primary }}>{formatInr(advanceTotal)}</Text>{' '}
                    {tenancyTotal > 0 ? (
                      <Text style={{ fontFamily: f.medium, color: colors.textMuted }}>
                        ({(advanceTotal / tenancyTotal).toFixed(1)}× rent)
                      </Text>
                    ) : null}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}

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
          Documents and deal terms are still edited in the web app's full form.
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
      <ContactPickerSheet
        visible={sheet === 'owner'}
        onClose={() => setSheet(null)}
        title="Owner / Agent"
        hint="Search your contacts — the assigned person shows on the property and gets owner digests."
        onSelect={(contact) => {
          setOwnerContactId(contact.id);
          setOwnerLabel(contact.name || contact.phone);
          setSheet(null);
        }}
        skipLabel={ownerContactId ? 'Clear assignment' : undefined}
        onSkip={
          ownerContactId
            ? () => {
                setOwnerContactId(null);
                setOwnerLabel('');
                setSheet(null);
              }
            : undefined
        }
      />
    </KeyboardAvoidingView>
  );
}

function TenancyDateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <SectionLabel text={label} style={{ color: colors.textMuted }} />
      <View style={[styles.select, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={{ flex: 1, justifyContent: 'center', alignSelf: 'stretch' }}
        >
          <Text
            style={{
              fontSize: 15,
              fontFamily: f.medium,
              color: value ? colors.text : colors.textFaint,
            }}
          >
            {value || 'Pick a date'}
          </Text>
        </Pressable>
        {value ? (
          <Pressable
            onPress={() => onChange('')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
          >
            <Ionicons name="close-circle" size={17} color={colors.textFaint} />
          </Pressable>
        ) : (
          <Ionicons name="calendar-outline" size={16} color={colors.textFaint} />
        )}
      </View>
      {open ? (
        <InlineDateTimePicker
          value={value ? new Date(`${value}T00:00:00`) : new Date()}
          mode="date"
          onChange={(d) => onChange(toIsoDate(d))}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </View>
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
  tenancyCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.md,
  },
  tenancyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addFloorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
});
