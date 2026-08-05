import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { anchoredMenuLayout } from '@/lib/anchored-menu';
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
  const windowSize = useWindowDimensions();
  // Measure the real modal frame rather than trusting window
  // dimensions, which misreport on foldables and split-screen — the
  // flip decision below is only as good as the height it reads.
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  if (!anchor) return null;

  const { left, top, maxHeight } = anchoredMenuLayout({
    anchorX: anchor.x,
    anchorY: anchor.y,
    menuWidth: MENU_WIDTH,
    contentHeight: actions.length * ROW_HEIGHT + spacing.xs * 2,
    frameWidth: frame.width || windowSize.width,
    frameHeight: frame.height || windowSize.height,
  });
  const fill = dark ? 'rgba(16,42,30,0.98)' : 'rgba(255,255,255,0.98)';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={{ flex: 1 }}
        onLayout={(e) =>
          setFrame({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
      >
        <View
          accessibilityViewIsModal
          style={[
            styles.menu,
            { left, top, maxHeight, backgroundColor: fill, borderColor: colors.glassBorder },
          ]}
        >
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
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
          </ScrollView>
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
    // Content-sized until maxHeight bites, then the scroll child shrinks
    // rather than the menu overflowing its cap.
    flexShrink: 1,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: ROW_HEIGHT,
    paddingHorizontal: spacing.lg,
  },
});
