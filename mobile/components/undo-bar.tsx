import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';

type UndoFn = () => Promise<void> | void;

export interface UndoBarHandle {
  show: (message: string, onUndo: UndoFn, durationMs?: number) => void;
  element: React.ReactNode;
}

/** A bottom "<message> · Undo" bar for one screen; render `element` once. */
export function useUndoBar(options?: { bottomOffset?: number }): UndoBarHandle {
  const { colors, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState<{
    key: number;
    message: string;
    onUndo: UndoFn;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const show = useCallback(
    (message: string, onUndo: UndoFn, durationMs = 8000) => {
      clearTimer();
      seq.current += 1;
      const key = seq.current;
      setEntry({ key, message, onUndo });
      timer.current = setTimeout(() => {
        timer.current = null;
        setEntry((current) => (current?.key === key ? null : current));
      }, durationMs);
    },
    [clearTimer]
  );

  async function undo() {
    if (!entry) return;
    const { onUndo } = entry;
    clearTimer();
    setEntry(null);
    haptic.tap();
    try {
      await onUndo();
    } catch {
      haptic.warn();
      Alert.alert('Could not undo', 'Check your connection and try again.');
    }
  }

  const bottom = Math.max(
    insets.bottom + spacing.md,
    options?.bottomOffset ?? 0
  );

  const element = entry ? (
    <View
      key={entry.key}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.bar,
        {
          bottom,
          backgroundColor: colors.surfaceWell,
          borderColor: colors.border,
        },
      ]}
    >
      <Text
        numberOfLines={2}
        style={[styles.message, { color: colors.text, fontFamily: f.medium }]}
      >
        {entry.message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Undo"
        hitSlop={8}
        onPress={() => void undo()}
        style={({ pressed }) => [styles.undo, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={{ color: colors.primary, fontFamily: f.bold }}>Undo</Text>
      </Pressable>
    </View>
  ) : null;

  return { show, element };
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  message: { flex: 1, fontSize: 14 },
  undo: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
});
