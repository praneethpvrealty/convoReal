import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';
import {
  pushUndoEntry,
  removeUndoEntry,
  undoBarLabel,
  visibleUndoEntry,
} from '@/lib/undo-queue';

type UndoFn = () => Promise<void> | void;

export interface UndoBarHandle {
  show: (message: string, onUndo: UndoFn, durationMs?: number) => void;
  element: React.ReactNode;
}

interface UndoEntry {
  key: number;
  message: string;
  onUndo: UndoFn;
  expiresAt: number;
}

/** A bottom "<message> · Undo" bar for one screen; render `element` once.
 *  Each action keeps its own Undo for its full window: a newer one stacks
 *  on top, and the earlier one shows again once the newer is gone. */
export function useUndoBar(options?: { bottomOffset?: number }): UndoBarHandle {
  const { colors, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<UndoEntry[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const seq = useRef(0);

  const clearTimer = useCallback((key: number) => {
    const timer = timers.current.get(key);
    if (timer) clearTimeout(timer);
    timers.current.delete(key);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const show = useCallback(
    (message: string, onUndo: UndoFn, durationMs = 8000) => {
      seq.current += 1;
      const key = seq.current;
      setEntries((current) =>
        pushUndoEntry(current, {
          key,
          message,
          onUndo,
          expiresAt: Date.now() + durationMs,
        })
      );
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          setEntries((current) => removeUndoEntry(current, key));
        }, durationMs)
      );
    },
    []
  );

  const entry = visibleUndoEntry(entries);

  async function undo() {
    if (!entry) return;
    const { key, onUndo } = entry;
    clearTimer(key);
    setEntries((current) => removeUndoEntry(current, key));
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
        {undoBarLabel(entry.message, entries.length)}
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
