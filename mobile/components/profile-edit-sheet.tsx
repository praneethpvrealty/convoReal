import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import {
  Banner,
  PrimaryButton,
  SectionLabel,
  TextField,
} from '@/components/ui';
import { ApiError, apiFetch, loadJourneyCompartments } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import {
  FOLLOW_COMPANY,
  PERSONAL_SHOWCASE_DESIGNS,
  followsCompanyDesign,
  isAgencyDesign,
  personalShowcaseChanged,
  pickPersonalDesign,
  resolveShowcasePresentation,
  setPersonalThreeDimensional,
  toPersonalShowcase,
  type PersonalShowcase,
  type ShowcaseStyle,
} from '@/lib/personal-showcase';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';

/** Web parity: PATCH /api/account rejects names longer than 80 chars. */
const MAX_ACCOUNT_NAME_LEN = 80;

const JOURNEY_SCOPE_OPTIONS: {
  value: 'team' | 'agent';
  label: string;
  detail: string;
}[] = [
  {
    value: 'team',
    label: 'Shared with the team',
    detail:
      'One Focus list for the account. Moving a journey moves it for everyone.',
  },
  {
    value: 'agent',
    label: 'Each agent keeps their own',
    detail:
      'Every agent curates their own Focus list. Nobody else’s moves change it.',
  },
];
const MAX_FULL_NAME_LEN = 120;

const CLASSIC_DESIGN_ICONS: Partial<
  Record<ShowcaseStyle, keyof typeof Ionicons.glyphMap>
> = {
  spotlight: 'sparkles-outline',
  editorial: 'book-outline',
  gallery: 'grid-outline',
  signature: 'person-outline',
};

interface ShowcaseDesignData {
  personal: PersonalShowcase;
  company: {
    showcase_style: unknown;
    showcase_3d_enabled: boolean | null;
  } | null;
}

async function fetchShowcaseDesign(
  userId: string,
  accountId: string
): Promise<ShowcaseDesignData> {
  const [personal, company] = await Promise.all([
    supabase
      .from('profiles')
      .select('showcase_style, showcase_3d_enabled')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('showcase_settings')
      .select('showcase_style, showcase_3d_enabled')
      .eq('account_id', accountId)
      .maybeSingle(),
  ]);
  if (personal.error) throw personal.error;
  return {
    personal: toPersonalShowcase(personal.data),
    company: company.data ?? null,
  };
}

export function ProfileEditSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);

  const canRenameAccount =
    profile?.account_role === 'owner' || profile?.account_role === 'admin';

  const [fullName, setFullName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [savedAccountName, setSavedAccountName] = useState<string | null>(null);
  const [compartmentScope, setCompartmentScope] = useState<
    'team' | 'agent' | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editedShowcase, setEditedShowcase] = useState<PersonalShowcase | null>(
    null
  );

  const userId = session?.user.id;
  const accountId = profile?.account_id;
  const scopeQuery = useQuery({
    queryKey: ['journey-compartment-scope', accountId],
    queryFn: async () => (await loadJourneyCompartments('buyer')).data.scope,
    enabled: visible && canRenameAccount && Boolean(accountId),
  });
  const savedScope = scopeQuery.data ?? null;
  const scope = compartmentScope ?? savedScope;
  const showcaseQuery = useQuery({
    queryKey: ['personal-showcase-design', userId, accountId],
    queryFn: () => fetchShowcaseDesign(userId as string, accountId as string),
    enabled: visible && Boolean(userId && accountId),
  });
  const savedShowcase = showcaseQuery.data?.personal ?? null;
  const showcase = editedShowcase ?? savedShowcase;
  const company = resolveShowcasePresentation(showcaseQuery.data?.company);
  const effective = resolveShowcasePresentation(showcaseQuery.data?.company, {
    showcase_style: showcase?.style,
    showcase_3d_enabled: showcase?.threeDimensional,
  });
  const companyLabel = PERSONAL_SHOWCASE_DESIGNS.find(
    (design) => design.value === company.style
  )?.label;

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setEditedShowcase(null);
    setCompartmentScope(null);
    setFullName(profile?.full_name ?? '');
    if (!canRenameAccount) return;
    let cancelled = false;
    apiFetch<{ account: { id: string; name: string } }>('/api/account')
      .then(({ account }) => {
        if (cancelled) return;
        setSavedAccountName(account.name);
        setAccountName(account.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible, profile?.full_name, canRenameAccount]);

  const save = async () => {
    if (!userId || !profile) return;

    const nextName = fullName.trim();
    if (!nextName) {
      setError('Display name is required.');
      return;
    }
    const nextAccountName = accountName.trim();
    const renameAccount =
      canRenameAccount &&
      savedAccountName !== null &&
      nextAccountName !== savedAccountName;
    if (renameAccount && !nextAccountName) {
      setError('Workspace name cannot be empty.');
      return;
    }

    const renamed = nextName !== (profile.full_name ?? '');
    const showcaseChanged =
      savedShowcase !== null &&
      editedShowcase !== null &&
      personalShowcaseChanged(savedShowcase, editedShowcase);

    setSaving(true);
    setError(null);
    try {
      if (renamed || showcaseChanged) {
        const { data: saved, error: updateError } = await supabase
          .from('profiles')
          .update({
            ...(renamed ? { full_name: nextName } : {}),
            ...(showcaseChanged && editedShowcase
              ? {
                  showcase_style: editedShowcase.style,
                  showcase_3d_enabled: editedShowcase.threeDimensional,
                }
              : {}),
          })
          .eq('user_id', userId)
          .select('user_id');
        if (updateError) throw new Error(updateError.message);
        if (!saved?.length)
          throw new Error('Your profile could not be updated.');
        if (renamed) setProfile({ ...profile, full_name: nextName });
        if (showcaseChanged) {
          await queryClient.invalidateQueries({
            queryKey: ['personal-showcase-design', userId, accountId],
          });
        }
      }
      if (renameAccount) {
        await apiFetch('/api/account', {
          method: 'PATCH',
          body: JSON.stringify({ name: nextAccountName }),
        });
        setSavedAccountName(nextAccountName);
      }
      if (canRenameAccount && scope && savedScope && scope !== savedScope) {
        await apiFetch('/api/account', {
          method: 'PATCH',
          body: JSON.stringify({ journey_compartment_scope: scope }),
        });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ['journey-compartment-scope', accountId],
          }),
          queryClient.invalidateQueries({
            queryKey: ['journey-compartments'],
          }),
        ]);
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Could not save — try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Edit profile">
      <ScrollView
        style={sheetScrollArea}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          gap: spacing.lg,
          paddingTop: spacing.sm,
        }}
      >
        {error ? <Banner kind="error" text={error} /> : null}
        <TextField
          label="Display name"
          icon="person-outline"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your name"
          maxLength={MAX_FULL_NAME_LEN}
          autoCapitalize="words"
          editable={!saving}
        />
        {canRenameAccount ? (
          <View style={{ gap: spacing.sm }}>
            <TextField
              label="Workspace name"
              icon="business-outline"
              value={accountName}
              onChangeText={setAccountName}
              placeholder={
                savedAccountName === null ? 'Loading…' : 'Workspace name'
              }
              maxLength={MAX_ACCOUNT_NAME_LEN}
              editable={!saving && savedAccountName !== null}
            />
            <Text
              style={{ fontSize: 12, lineHeight: 17, color: colors.textFaint }}
            >
              The workspace name is shared with your whole team.
            </Text>
          </View>
        ) : null}
        {canRenameAccount && scope ? (
          <View style={{ gap: spacing.sm }}>
            <SectionLabel text="Journey Focus list" />
            <Text
              style={{ fontSize: 12, lineHeight: 17, color: colors.textFaint }}
            >
              Each journey stage lists Focus journeys first and keeps the rest
              under Passive. Choose whether that split is shared.
            </Text>
            {JOURNEY_SCOPE_OPTIONS.map((option) => {
              const selected = scope === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: selected, disabled: saving }}
                  disabled={saving}
                  onPress={() => setCompartmentScope(option.value)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    borderWidth: 1,
                    borderRadius: radius.md,
                    borderColor: selected ? colors.primary : colors.glassBorder,
                    backgroundColor: colors.glass,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {option.label}
                    </Text>
                    <Text
                      style={{
                        fontSize: 12,
                        lineHeight: 17,
                        color: colors.textMuted,
                      }}
                    >
                      {option.detail}
                    </Text>
                  </View>
                  {selected ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.primary}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {showcase ? (
          <View style={{ gap: spacing.sm }}>
            <SectionLabel text="Personal showcase design" />
            <Text
              style={{ fontSize: 12, lineHeight: 17, color: colors.textFaint }}
            >
              Choose how properties appear on your personal agent showcase link.
            </Text>
            {PERSONAL_SHOWCASE_DESIGNS.map((design) => {
              const selected = effective.style === design.value;
              const icon = CLASSIC_DESIGN_ICONS[design.value];
              return (
                <Pressable
                  key={design.value}
                  accessibilityRole="radio"
                  accessibilityLabel={design.label}
                  accessibilityState={{ checked: selected, disabled: saving }}
                  disabled={saving}
                  onPress={() =>
                    setEditedShowcase(
                      pickPersonalDesign(
                        showcase,
                        design.value,
                        effective.threeDimensional
                      )
                    )
                  }
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    borderWidth: 1,
                    borderRadius: radius.md,
                    borderColor: selected ? colors.primary : colors.glassBorder,
                    backgroundColor: colors.glass,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor:
                        design.swatch?.background ?? colors.primarySoft,
                    }}
                  >
                    {design.swatch ? (
                      <View
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 5,
                          backgroundColor: design.swatch.accent,
                        }}
                      />
                    ) : icon ? (
                      <Ionicons name={icon} size={18} color={colors.primary} />
                    ) : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {design.label}
                    </Text>
                    <Text
                      style={{
                        fontSize: 12,
                        lineHeight: 17,
                        color: colors.textMuted,
                      }}
                    >
                      {design.detail}
                    </Text>
                  </View>
                  {selected ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.primary}
                    />
                  ) : null}
                </Pressable>
              );
            })}
            {!isAgencyDesign(effective.style) ? (
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="3D property transitions"
                accessibilityState={{
                  checked: effective.threeDimensional,
                  disabled: saving,
                }}
                disabled={saving}
                onPress={() =>
                  setEditedShowcase(
                    setPersonalThreeDimensional(
                      showcase,
                      !effective.threeDimensional,
                      effective.style
                    )
                  )
                }
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderWidth: 1,
                  borderRadius: radius.md,
                  borderColor: effective.threeDimensional
                    ? colors.primary
                    : colors.glassBorder,
                  backgroundColor: colors.glass,
                }}
              >
                <Ionicons
                  name="cube-outline"
                  size={18}
                  color={colors.primary}
                />
                <Text
                  style={{ flex: 1, color: colors.text, fontWeight: '600' }}
                >
                  3D property transitions
                </Text>
                <Text style={{ color: colors.textMuted }}>
                  {effective.threeDimensional ? 'On' : 'Off'}
                </Text>
              </Pressable>
            ) : null}
            {followsCompanyDesign(showcase) ? (
              <Text
                style={{
                  fontSize: 12,
                  lineHeight: 17,
                  color: colors.textFaint,
                }}
              >
                Following the company design
                {companyLabel ? ` (${companyLabel})` : ''}. Pick a design above
                to use your own.
              </Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => setEditedShowcase(FOLLOW_COMPANY)}
                style={{ paddingVertical: spacing.sm }}
              >
                <Text style={{ color: colors.primary, fontWeight: '600' }}>
                  Use the company design instead
                </Text>
              </Pressable>
            )}
          </View>
        ) : null}
        <PrimaryButton label="Save changes" onPress={save} busy={saving} />
      </ScrollView>
    </BottomSheet>
  );
}
