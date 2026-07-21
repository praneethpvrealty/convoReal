import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { Banner, PrimaryButton, TextField } from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import { spacing, useTheme } from '@/lib/theme';

/** Web parity: PATCH /api/account rejects names longer than 80 chars. */
const MAX_ACCOUNT_NAME_LEN = 80;
const MAX_FULL_NAME_LEN = 120;

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
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
    const userId = session?.user.id;
    if (!userId || !profile) return;

    const nextName = fullName.trim();
    if (!nextName) {
      setError('Display name is required.');
      return;
    }
    const nextAccountName = accountName.trim();
    const renameAccount =
      canRenameAccount && savedAccountName !== null && nextAccountName !== savedAccountName;
    if (renameAccount && !nextAccountName) {
      setError('Workspace name cannot be empty.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (nextName !== (profile.full_name ?? '')) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ full_name: nextName })
          .eq('user_id', userId);
        if (updateError) throw new Error(updateError.message);
        setProfile({ ...profile, full_name: nextName });
      }
      if (renameAccount) {
        await apiFetch('/api/account', {
          method: 'PATCH',
          body: JSON.stringify({ name: nextAccountName }),
        });
        setSavedAccountName(nextAccountName);
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
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg, paddingTop: spacing.sm }}>
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
              placeholder={savedAccountName === null ? 'Loading…' : 'Workspace name'}
              maxLength={MAX_ACCOUNT_NAME_LEN}
              editable={!saving && savedAccountName !== null}
            />
            <Text style={{ fontSize: 12, lineHeight: 17, color: colors.textFaint }}>
              The workspace name is shared with your whole team.
            </Text>
          </View>
        ) : null}
        <PrimaryButton label="Save changes" onPress={save} busy={saving} />
      </View>
    </BottomSheet>
  );
}
