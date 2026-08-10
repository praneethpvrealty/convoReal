import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from 'react-native';

import { ApiError } from '@/lib/api';
import { signOut } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';

interface DeleteAccountRowProps {
  /** What this user specifically loses — spelled out in the first prompt. */
  consequence: string;
  /** Performs the deletion; the session is torn down after it resolves. */
  onDelete: () => Promise<unknown>;
  /** Runs after sign-out, e.g. to reset the Den/staff surface flag. */
  onDeleted?: () => void;
}

/**
 * In-app account deletion — required of every app that can create an
 * account (App Store Guideline 5.1.1(v)). Two prompts, because the
 * action is irreversible and the second one is the last exit.
 */
export function DeleteAccountRow({ consequence, onDelete, onDeleted }: DeleteAccountRowProps) {
  const { colors, fonts: f } = useTheme();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await onDelete();
      await signOut();
      onDeleted?.();
    } catch (e) {
      Alert.alert(
        'Could not delete your account',
        friendlyError(e instanceof ApiError ? e.message : 'Try again in a moment.')
      );
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    haptic.warn();
    Alert.alert('Delete account?', consequence, [
      { text: 'Keep my account', style: 'cancel' },
      {
        text: 'Continue',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            'This cannot be undone',
            'Your account and its data are deleted permanently. There is no way to restore them.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete forever', style: 'destructive', onPress: run },
            ]
          ),
      },
    ]);
  }

  return (
    <Pressable
      onPress={confirm}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Delete my account"
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.danger, opacity: pressed || busy ? 0.6 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.danger} />
      ) : (
        <Ionicons name="trash-outline" size={18} color={colors.danger} />
      )}
      <Text style={{ color: colors.danger, fontSize: 15.5, fontFamily: f.bold }}>
        Delete my account
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 15,
  },
});
