import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptic } from '@/lib/haptics';
import { radius, useTheme } from '@/lib/theme';
import { useNotifications } from '@/lib/use-notifications';

/** Header bell with a live unread badge — opens the notifications list. */
export function NotificationBell() {
  const { colors, fonts: f } = useTheme();
  const { unread } = useNotifications();

  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        router.push('/(app)/notifications');
      }}
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
      }
      hitSlop={6}
      style={[styles.bell, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
    >
      <Ionicons name="notifications-outline" size={19} color={colors.text} />
      {unread > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.background }]}>
          <Text style={[styles.badgeText, { fontFamily: f.bold }]}>
            {unread > 99 ? '99+' : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10 },
});
