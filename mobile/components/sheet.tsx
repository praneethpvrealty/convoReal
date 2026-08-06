import { Ionicons } from '@expo/vector-icons';
import { createContext, useContext, useEffect, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, useTheme } from '@/lib/theme';

const SheetFrameContext = createContext(0);

/** Height available to the open sheet: its modal frame minus the
 *  keyboard, measured from layout — window dimensions misreport on
 *  foldables, split-screen and freeform windows. Window height stands
 *  in until the first layout pass. */
export function useSheetFrame(): number {
  const measured = useContext(SheetFrameContext);
  const windowHeight = useWindowDimensions().height;
  return measured > 0 ? measured : windowHeight;
}

/** Scroll areas inside a sheet: content-sized until the sheet hits its
 *  height cap, then shrunk so they scroll instead of pushing content
 *  and footers past the cap. Any View between the sheet and the scroll
 *  area needs flexShrink: 1 of its own, or it blocks the shrink. */
export const sheetScrollArea: ViewStyle = { flexGrow: 0, flexShrink: 1 };

/** Track the on-screen keyboard height so a bottom-anchored sheet can
 *  lift its content above it (RN Modals don't resize for the keyboard,
 *  so an input at the sheet's foot would otherwise sit behind it). */
function useKeyboardHeight(active: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!active) {
      setHeight(0);
      return;
    }
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(show, (e) => setHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hide, () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [active]);
  return height;
}

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
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight(visible);
  const [frameHeight, setFrameHeight] = useState(0);
  const available = Math.max(0, frameHeight - keyboardHeight);
  return (
    <Modal
      visible={visible}
      transparent
      animationType={animation}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.backdrop, paddingBottom: keyboardHeight }]}
        onLayout={(e) => setFrameHeight(e.nativeEvent.layout.height)}
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
              backgroundColor: colors.surfaceWell,
              borderColor: colors.glassBorder,
              paddingBottom:
                keyboardHeight > 0
                  ? spacing.md
                  : Math.max(insets.bottom, spacing.md) + spacing.md,
            },
            available > 0 ? { maxHeight: Math.round(available * 0.88) } : null,
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
          <SheetFrameContext.Provider value={available}>{children}</SheetFrameContext.Provider>
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
