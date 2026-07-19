import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { radius, spacing, useTheme } from '@/lib/theme';

export interface ContextMenuAction {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}

const MENU_WIDTH = 250;
const ROW_HEIGHT = 48;

/**
 * A floating context menu anchored at the press point — the
 * launcher-style popover, not a centered system dialog. Opaque fill
 * on purpose: it floats over arbitrary content (same rule as sheets
 * and dropdowns), so it may carry a real shadow.
 */
export function ContextMenu({
  anchor,
  actions,
  onClose,
}: {
  /** Screen coordinates of the long-press (pageX/pageY); null = hidden. */
  anchor: { x: number; y: number } | null;
  actions: ContextMenuAction[];
  onClose: () => void;
}) {
  const { colors, dark, fonts: f } = useTheme();
  const { width, height } = useWindowDimensions();
  if (!anchor) return null;

  const menuHeight = actions.length * ROW_HEIGHT + spacing.xs * 2;
  const left = Math.min(Math.max(anchor.x - MENU_WIDTH / 2, 12), width - MENU_WIDTH - 12);
  const top =
    anchor.y + 14 + menuHeight > height ? anchor.y - menuHeight - 14 : anchor.y + 14;
  const fill = dark ? 'rgba(16,42,30,0.98)' : 'rgba(255,255,255,0.98)';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={{ flex: 1 }}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
      >
        <View
          accessibilityViewIsModal
          style={[
            styles.menu,
            { left, top, backgroundColor: fill, borderColor: colors.glassBorder },
          ]}
        >
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => {
                onClose();
                a.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              android_ripple={{ color: colors.border }}
              style={styles.row}
            >
              <Ionicons name={a.icon} size={18} color={colors.primary} />
              <Text style={{ fontSize: 14.5, fontFamily: f.semibold, color: colors.text }}>
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: ROW_HEIGHT,
    paddingHorizontal: spacing.lg,
  },
});
