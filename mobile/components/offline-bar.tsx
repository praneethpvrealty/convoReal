import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useIsOnline } from '@/lib/online';
import { radius, spacing, useTheme } from '@/lib/theme';

export function OfflineBar() {
  const online = useIsOnline();
  const insets = useSafeAreaInsets();
  const { colors, fonts: f } = useTheme();
  if (online) return null;
  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + spacing.xs }]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <View
        style={[
          styles.bar,
          { backgroundColor: colors.surfaceWell, borderColor: colors.border },
        ]}
      >
        <Ionicons
          name="cloud-offline-outline"
          size={14}
          color={colors.warning}
        />
        <Text
          style={{ fontSize: 12.5, fontFamily: f.semibold, color: colors.text }}
        >
          Offline — showing saved data
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
