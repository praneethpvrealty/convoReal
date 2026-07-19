import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * The one bottom sheet: themed scrim, glass border, drag handle,
 * safe-area bottom padding, Android back-button dismissal, backdrop
 * tap-to-close and `accessibilityViewIsModal` handled in one place.
 * Children provide their own horizontal padding unless a `title` is
 * given (which brings the standard header row).
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  title,
  animation = 'slide',
  contentStyle,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  animation?: 'slide' | 'fade';
  contentStyle?: ViewStyle;
}) {
  const { colors, dark, type } = useTheme();
  const insets = useSafeAreaInsets();
  // Near-opaque on purpose: the sheet floats over arbitrary screen
  // content, and a translucent glass fill lets the list underneath
  // read straight through the sheet (same rule as dropdowns and
  // sticky bars — glass is for surfaces over the aurora only).
  const sheetFill = dark ? 'rgba(13,36,26,0.98)' : 'rgba(255,255,255,0.98)';
  return (
    <Modal
      visible={visible}
      transparent
      animationType={animation}
      onRequestClose={onClose}
      statusBarTranslucent
    >
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
              backgroundColor: sheetFill,
              borderColor: colors.glassBorder,
              paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.md,
            },
            contentStyle,
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.textFaint }]} />
          {title ? (
            <View style={styles.head}>
              <Text style={[type.heading, { color: colors.text }]}>{title}</Text>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                accessibilityLabel="Close"
                accessibilityRole="button"
                style={styles.close}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>
          ) : null}
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
    borderWidth: 1,
    paddingTop: spacing.sm,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.sm,
    opacity: 0.5,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
