import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { authenticate, useAppLock } from '@/lib/app-lock';
import { signOut } from '@/lib/auth-store';
import { spacing, radius, useTheme } from '@/lib/theme';

/**
 * Biometric app lock. Mounted inside the signed-in shell: when the lock
 * is enabled it covers the app on cold start and whenever it returns
 * from the background, until the OS fingerprint/face prompt succeeds.
 * Renders nothing when disabled or unlocked.
 */
export function AppLockGate() {
  const { colors, fonts: f } = useTheme();
  const enabled = useAppLock((s) => s.enabled);
  const locked = useAppLock((s) => s.locked);
  const setLocked = useAppLock((s) => s.setLocked);
  const prompting = useRef(false);

  // Re-lock when the app goes to the background.
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') setLocked(true);
    });
    return () => sub.remove();
  }, [enabled, setLocked]);

  // Fire the OS prompt as soon as we're locked (and on retry).
  async function unlock() {
    if (prompting.current) return;
    prompting.current = true;
    const ok = await authenticate();
    prompting.current = false;
    if (ok) setLocked(false);
  }

  useEffect(() => {
    if (enabled && locked) void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, locked]);

  if (!enabled || !locked) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: colors.background }]}>
      <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="finger-print" size={40} color={colors.primary} />
      </View>
      <Text style={{ fontSize: 20, fontFamily: f.extrabold, color: colors.text }}>
        ConvoReal is locked
      </Text>
      <Text style={{ fontSize: 13.5, color: colors.textMuted, textAlign: 'center' }}>
        Unlock with your fingerprint or face to continue.
      </Text>
      <Pressable
        onPress={unlock}
        accessibilityRole="button"
        accessibilityLabel="Unlock"
        style={({ pressed }) => [
          styles.unlockButton,
          { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Ionicons name="lock-open-outline" size={17} color={colors.onPrimary} />
        <Text style={{ fontSize: 15, fontFamily: f.bold, color: colors.onPrimary }}>Unlock</Text>
      </Pressable>
      <Pressable onPress={() => signOut()} accessibilityRole="button" accessibilityLabel="Sign out">
        <Text style={{ fontSize: 13.5, fontFamily: f.semibold, color: colors.textMuted }}>
          Sign out instead
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    zIndex: 1000,
    elevation: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  badge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  unlockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.full,
    paddingHorizontal: 28,
    paddingVertical: 13,
    marginTop: spacing.sm,
  },
});
