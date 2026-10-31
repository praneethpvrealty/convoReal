import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ConvoRealLoader } from '@/components/loader';
import { EmptyState } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { chatListTime } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { notificationTarget } from '@/lib/notification-target';
import { radius, spacing, useTheme } from '@/lib/theme';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import {
  markAllNotificationsRead,
  useNotifications,
} from '@/lib/use-notifications';
import { LoadErrorState } from '@/components/load-error';

const TYPE_ICONS: Record<
  string,
  React.ComponentProps<typeof Ionicons>['name']
> = {
  new_message: 'chatbubbles-outline',
  appointment_booked: 'calendar-outline',
  appointment_reminder: 'alarm-outline',
  appointment_overdue: 'checkmark-done-outline',
  daily_digest: 'sunny-outline',
  location_request: 'location-outline',
  document_request: 'document-text-outline',
  listing_interest: 'eye-outline',
  portal_listing_expiry: 'time-outline',
  requirement_shared: 'swap-horizontal-outline',
  requirement_response: 'home-outline',
};

export default function NotificationsScreen() {
  const { colors, fonts: f } = useTheme();
  const userId = useAuthStore((s) => s.session?.user.id);
  const { items, unread, isLoading, isError, refetch } = useNotifications();
  const pull = usePullRefresh(refetch);

  // Opening the screen marks everything read (web-bell parity) — once
  // per mount, after the first load has shown the unread styling.
  const marked = useRef(false);
  useEffect(() => {
    if (!userId || marked.current || isLoading) return;
    marked.current = true;
    if (unread > 0) void markAllNotificationsRead(userId);
  }, [userId, unread, isLoading]);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Notifications' }} />
      {isLoading ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <ConvoRealLoader />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={[
            styles.list,
            items.length === 0 && { flexGrow: 1 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            isError ? (
              <LoadErrorState
                title="Couldn’t load notifications"
                onRetry={() => void refetch()}
              />
            ) : (
              <EmptyState
                icon="notifications-off-outline"
                title="No notifications"
                subtitle="New leads, replies and bookings will show up here."
              />
            )
          }
          renderItem={({ item }) => {
            const fresh = !item.read_at;
            const target = notificationTarget(item);
            return (
              <Pressable
                disabled={!target}
                onPress={() => {
                  if (!target) return;
                  haptic.tap();
                  router.push(target);
                }}
                accessibilityRole={target ? 'button' : 'text'}
                accessibilityLabel={item.title}
                style={[
                  styles.row,
                  {
                    backgroundColor: fresh ? colors.primarySoft : colors.glass,
                    borderColor: fresh ? colors.primary : colors.glassBorder,
                  },
                ]}
              >
                <View
                  style={[
                    styles.iconWrap,
                    { backgroundColor: colors.surfaceRaised },
                  ]}
                >
                  <Ionicons
                    name={TYPE_ICONS[item.type] ?? 'notifications-outline'}
                    size={18}
                    color={fresh ? colors.primary : colors.textMuted}
                  />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    style={{
                      fontSize: 14,
                      fontFamily: fresh ? f.bold : f.semibold,
                      color: colors.text,
                    }}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  {item.body ? (
                    <Text
                      style={{
                        fontSize: 12.5,
                        lineHeight: 17,
                        color: colors.textMuted,
                      }}
                      numberOfLines={2}
                    >
                      {item.body}
                    </Text>
                  ) : null}
                </View>
                <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
                  {chatListTime(item.created_at)}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
