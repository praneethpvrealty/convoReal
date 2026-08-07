import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, useTheme } from '@/lib/theme';

export interface DialogAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'default' | 'muted' | 'destructive';
}

export interface DialogSpec {
  title: string;
  message?: string;
  /** Omit for a single primary "OK" that dismisses. */
  actions?: DialogAction[];
}

/**
 * Local dialog state for one screen or sheet. The dialog renders where
 * the hook is used, not at the root: a Modal presented from outside the
 * currently-open sheet can end up behind it, so confirmations raised
 * inside a BottomSheet have to live inside that sheet's tree.
 */
export function useAppDialog() {
  const [spec, setSpec] = useState<DialogSpec | null>(null);
  const close = useCallback(() => setSpec(null), []);
  const show = useCallback((next: DialogSpec) => setSpec(next), []);

  return {
    show,
    close,
    dialogProps: {
      visible: spec !== null,
      onClose: close,
      title: spec?.title ?? '',
      message: spec?.message,
      actions: spec?.actions,
    },
  };
}

/**
 * The one in-app alert: a themed, centered card matching the app's dark
 * glass surfaces, so confirmations don't drop to the raw white OS dialog.
 * Backdrop tap and Android back both dismiss via `onClose`.
 */
export function AppDialog({
  visible,
  onClose,
  title,
  message,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  actions?: DialogAction[];
}) {
  const { colors, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
  const resolvedActions: DialogAction[] = actions?.length
    ? actions
    : [{ label: 'OK', variant: 'primary', onPress: onClose }];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.backdrop, paddingBottom: insets.bottom }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          style={[
            styles.card,
            { backgroundColor: colors.surfaceWell, borderColor: colors.glassBorder },
          ]}
        >
          <Text style={{ fontSize: 17, fontFamily: f.bold, color: colors.text }}>{title}</Text>
          {message ? (
            // Scrolls rather than growing: a long message on a short
            // screen — landscape, or an unfolded device — would otherwise
            // push the actions past the bottom of the card, leaving a
            // confirmation with no reachable way to confirm.
            <ScrollView style={{ flexGrow: 0, flexShrink: 1 }}>
              <Text style={{ fontSize: 13.5, lineHeight: 20, color: colors.textMuted }}>
                {message}
              </Text>
            </ScrollView>
          ) : null}
          <View style={styles.actions}>
            {resolvedActions.map((a) => {
              const isPrimary = a.variant === 'primary';
              const isDestructive = a.variant === 'destructive';
              return (
                <Pressable
                  key={a.label}
                  onPress={a.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={a.label}
                  style={[
                    styles.action,
                    isPrimary
                      ? { backgroundColor: colors.primary }
                      : isDestructive
                        ? { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderWidth: 1 }
                        : { backgroundColor: colors.glass, borderColor: colors.glassBorder, borderWidth: 1 },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontFamily: f.bold,
                      color: isPrimary
                        ? colors.onPrimary
                        : isDestructive
                          ? colors.danger
                          : a.variant === 'muted'
                            ? colors.textMuted
                            : colors.text,
                    }}
                  >
                    {a.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '85%',
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  action: {
    minHeight: 42,
    borderRadius: radius.full,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
