import { useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { ConvoRealLoader } from '@/components/loader';
import { Banner, FilterChip, PrimaryButton, SectionLabel, TextField } from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { spacing, useTheme , fonts } from '@/lib/theme';
import type { Property } from '@/lib/types';

const STATUSES = ['Available', 'Under Contract', 'Sold', 'Off Market', 'Archived'] as const;

async function fetchProperty(id: string): Promise<Property | null> {
  const { data, error } = await supabase
    .from('properties')
    .select(
      'id, title, description, price, rent_per_month, maintenance, status, listing_type, ' +
        'bedrooms, bathrooms, area_sqft, area_unit, is_published'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Property | null;
}

/**
 * Quick edit: the handful of fields agents change from the field —
 * title, price/rent, status, specs, description, published. The full
 * 50-field form (photos, documents, locality, deal terms) stays on
 * the web; saves go through the same PUT /api/properties/[id].
 */
export default function PropertyEditScreen() {
  const { colors } = useTheme();
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
  const isRent = property.listing_type === 'Rent' || property.listing_type === 'Built to Suit';

  const [title, setTitle] = useState(property.title);
  const [price, setPrice] = useState(property.price ? String(property.price) : '');
  const [rent, setRent] = useState(property.rent_per_month ? String(property.rent_per_month) : '');
  const [maintenance, setMaintenance] = useState(
    property.maintenance ? String(property.maintenance) : ''
  );
  const [status, setStatus] = useState(property.status ?? 'Available');
  const [bedrooms, setBedrooms] = useState(property.bedrooms ? String(property.bedrooms) : '');
  const [bathrooms, setBathrooms] = useState(property.bathrooms ? String(property.bathrooms) : '');
  const [area, setArea] = useState(property.area_sqft ? String(property.area_sqft) : '');
  const [description, setDescription] = useState(property.description ?? '');
  const [published, setPublished] = useState(Boolean(property.is_published));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      description: description.trim() || null,
      is_published: published,
      bedrooms: num(bedrooms),
      bathrooms: num(bathrooms),
      area_sqft: num(area),
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

        <TextField label="Title" value={title} onChangeText={setTitle} />

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
            <TextField
              label="Bedrooms"
              value={bedrooms}
              onChangeText={setBedrooms}
              keyboardType="numeric"
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label="Bathrooms"
              value={bathrooms}
              onChangeText={setBathrooms}
              keyboardType="numeric"
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label={`Area (${property.area_unit || 'sqft'})`}
              value={area}
              onChangeText={setArea}
              keyboardType="numeric"
            />
          </View>
        </View>

        <TextField
          label="Description"
          value={description}
          onChangeText={setDescription}
          multiline
        />

        <View style={styles.publishRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, fontFamily: f.bold, color: colors.text }}>
              Published on showcase
            </Text>
            <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
              Unpublished listings stay internal to the CRM.
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
          Photos, documents, locality and deal terms are edited in the web app's full form.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  row: { flexDirection: 'row', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  publishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
});
