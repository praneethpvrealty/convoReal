import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, useTheme } from '@/lib/theme';

export interface DialogAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'default' | 'muted';
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
  actions: DialogAction[];
}) {
  const { colors, dark, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
  const cardFill = dark ? 'rgba(13,36,26,0.98)' : 'rgba(255,255,255,0.99)';

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
          style={[styles.card, { backgroundColor: cardFill, borderColor: colors.glassBorder }]}
        >
          <Text style={{ fontSize: 17, fontFamily: f.bold, color: colors.text }}>{title}</Text>
          {message ? (
            <Text style={{ fontSize: 13.5, lineHeight: 20, color: colors.textMuted }}>{message}</Text>
          ) : null}
          <View style={styles.actions}>
            {actions.map((a) => {
              const isPrimary = a.variant === 'primary';
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
                      : { backgroundColor: colors.glass, borderColor: colors.glassBorder, borderWidth: 1 },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontFamily: f.bold,
                      color: isPrimary
                        ? colors.onPrimary
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
