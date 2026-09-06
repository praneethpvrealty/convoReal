import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ConvoRealLoader } from '@/components/loader';
import { Banner, PrimaryButton, SectionLabel } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { getShowcaseUrl } from '@/lib/welcome-message';
import type { ShowcaseStyle } from '@shared/lib/showcase/style';
import { radius, spacing, useTheme } from '@/lib/theme';

type PublicProfileSettings = {
  showcase_style: ShowcaseStyle;
  public_business_description: string | null;
  public_areas_served: string[] | null;
  public_property_expertise: string[] | null;
};

const EMPTY: PublicProfileSettings = {
  showcase_style: 'gallery',
  public_business_description: null,
  public_areas_served: null,
  public_property_expertise: null,
};

function parseList(value: string): string[] | null {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
  return items.length > 0 ? items : null;
}

async function fetchPublicProfile(
  accountId: string
): Promise<PublicProfileSettings> {
  const { data, error } = await supabase
    .from('showcase_settings')
    .select(
      'public_business_description, public_areas_served, public_property_expertise, showcase_style'
    )
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  return (data as PublicProfileSettings | null) ?? EMPTY;
}

export default function ShowcaseProfileScreen() {
  const profile = useAuthStore((state) => state.profile);
  const accountId = profile?.account_id;
  const canEdit = profile?.org_role
    ? profile.org_role === 'org_manager' || profile.org_role === 'org_leader'
    : profile?.account_role === 'owner' || profile?.account_role === 'admin';
  const {
    data,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: ['showcase-public-profile', accountId],
    queryFn: () => fetchPublicProfile(accountId as string),
    enabled: Boolean(accountId),
  });

  if (isLoading) return <ConvoRealLoader />;

  return (
    <PublicProfileForm
      key={accountId}
      accountId={accountId ?? null}
      canEdit={canEdit}
      initial={data ?? EMPTY}
      loadFailed={Boolean(loadError)}
    />
  );
}

function PublicProfileForm({
  accountId,
  canEdit,
  initial,
  loadFailed,
}: {
  accountId: string | null;
  canEdit: boolean;
  initial: PublicProfileSettings;
  loadFailed: boolean;
}) {
  const { colors } = useTheme();
  const [description, setDescription] = useState(
    initial.public_business_description ?? ''
  );
  const [areas, setAreas] = useState(
    (initial.public_areas_served ?? []).join(', ')
  );
  const [expertise, setExpertise] = useState(
    (initial.public_property_expertise ?? []).join(', ')
  );
  const [showcaseStyle, setShowcaseStyle] = useState<ShowcaseStyle>(
    initial.showcase_style
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: 'error' | 'success';
    text: string;
  } | null>(null);

  async function save() {
    if (!accountId || !canEdit) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch('/api/showcase/public-profile', {
        method: 'PATCH',
        body: JSON.stringify({
          showcaseStyle,
          description: description.trim() || null,
          areasServed: parseList(areas),
          propertyExpertise: parseList(expertise),
        }),
      });
    } catch {
      haptic.warn();
      setMessage({ kind: 'error', text: 'Could not save. Please try again.' });
      return;
    } finally {
      setSaving(false);
    }
    await queryClient.invalidateQueries({
      queryKey: ['showcase-public-profile', accountId],
    });
    await queryClient.invalidateQueries({
      queryKey: ['showcase-settings', accountId],
    });
    haptic.success();
    setMessage({ kind: 'success', text: 'Public business profile saved' });
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{ headerShown: true, title: 'Public business profile' }}
      />
      <SectionLabel text="Agency showcase design" />
      <Text style={[styles.intro, { color: colors.textMuted }]}>
        Choose the design visitors see on your agency showcase, on desktop and
        mobile.
      </Text>
      {(
        [
          {
            value: 'warm-editorial',
            label: 'Warm editorial',
            detail: 'Ivory, forest green and large photos',
            background: '#f7f5ef',
            accent: '#244b3b',
          },
          {
            value: 'map-discovery',
            label: 'Map-led discovery',
            detail: 'Bright listings and publicly shared map locations',
            background: '#ffffff',
            accent: '#1453ff',
          },
          {
            value: 'quiet-luxury',
            label: 'Quiet luxury',
            detail: 'Charcoal, brass and spacious property cards',
            background: '#202420',
            accent: '#bea775',
          },
        ] as const
      ).map((design) => (
        <Pressable
          key={design.value}
          accessibilityRole="radio"
          accessibilityLabel={design.label}
          accessibilityState={{
            checked: showcaseStyle === design.value,
            disabled: !canEdit || saving,
          }}
          disabled={!canEdit || saving}
          onPress={() => setShowcaseStyle(design.value)}
          style={[
            styles.design,
            {
              borderColor:
                showcaseStyle === design.value
                  ? colors.primary
                  : colors.glassBorder,
              backgroundColor: colors.glass,
            },
          ]}
        >
          <View style={[styles.swatch, { backgroundColor: design.background }]}>
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                backgroundColor: design.accent,
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>
              {design.label}
            </Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {design.detail}
            </Text>
          </View>
          {showcaseStyle === design.value && (
            <Text style={{ color: colors.primary }}>Selected</Text>
          )}
        </Pressable>
      ))}
      <PrimaryButton
        label="Preview selected design"
        icon="eye-outline"
        disabled={loadFailed || !accountId}
        onPress={async () => {
          try {
            const url = new URL(await getShowcaseUrl());
            url.searchParams.set('preview_style', showcaseStyle);
            await Linking.openURL(url.toString());
          } catch {
            setMessage({
              kind: 'error',
              text: 'Could not open the showcase preview.',
            });
          }
        }}
      />
      <SectionLabel text="Showcase About section" />
      <Text style={[styles.intro, { color: colors.textMuted }]}>
        Edit the About copy, service areas, and property expertise shown on your
        public showcase and search pages.
      </Text>
      {loadFailed ? (
        <Banner kind="error" text="Could not load the public profile." />
      ) : null}
      {!canEdit ? (
        <Banner
          kind="info"
          text="Only account admins can change the public business profile."
        />
      ) : null}
      {message ? <Banner kind={message.kind} text={message.text} /> : null}

      <Field
        label="About your business"
        hint="Leave blank to use a polished summary based on published inventory."
        value={description}
        onChangeText={setDescription}
        placeholder="Describe your services, specialities, and the clients you help."
        editable={canEdit}
        multiline
        maxLength={600}
      />
      <Field
        label="Areas served"
        hint="Separate areas with commas. Leave blank to derive them from published properties."
        value={areas}
        onChangeText={setAreas}
        placeholder="Bengaluru, JP Nagar, Koramangala"
        editable={canEdit}
      />
      <Field
        label="Property expertise"
        hint="Separate specialities with commas. Leave blank to use published property types."
        value={expertise}
        onChangeText={setExpertise}
        placeholder="Residential Land, Commercial Property, Apartments"
        editable={canEdit}
      />
      <PrimaryButton
        label="Save public profile"
        icon="save-outline"
        onPress={save}
        busy={saving}
        disabled={!canEdit || loadFailed}
      />
    </ScrollView>
  );
}

function Field({
  label,
  hint,
  multiline = false,
  ...inputProps
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  hint: string;
  multiline?: boolean;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text, fontFamily: f.bold }]}>
        {label}
      </Text>
      <TextInput
        {...inputProps}
        multiline={multiline}
        placeholderTextColor={colors.textFaint}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: colors.text,
            backgroundColor: colors.glass,
            borderColor: colors.glassBorder,
            fontFamily: f.regular,
          },
        ]}
      />
      <Text style={[styles.hint, { color: colors.textMuted }]}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  design: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 76,
  },
  swatch: {
    width: 52,
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  intro: { fontSize: 14, lineHeight: 20 },
  field: { gap: spacing.xs },
  label: { fontSize: 14.5 },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
  },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  hint: { fontSize: 12, lineHeight: 17 },
});
