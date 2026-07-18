import { Modal, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * The one bottom sheet: themed scrim, rounded top, safe-area bottom
 * padding, Android back-button dismissal, backdrop tap-to-close and
 * `accessibilityViewIsModal` handled in one place. Children provide
 * their own horizontal padding.
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  animation = 'slide',
  contentStyle,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  animation?: 'slide' | 'fade';
  contentStyle?: ViewStyle;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType={animation} onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.backdrop }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceRaised,
              paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.md,
            },
            contentStyle,
          ]}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
  },
});
