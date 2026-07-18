import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, Stack } from 'expo-router';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EmptyState } from '@/components/ui';
import { chatListTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { radius, shadows, spacing, useTheme, type ThemeColors , fonts } from '@/lib/theme';
import type { Broadcast } from '@/lib/types';

function statusColor(status: Broadcast['status'], colors: ThemeColors): string {
  switch (status) {
    case 'sent':
      return colors.success;
    case 'sending':
    case 'scheduled':
      return colors.warning;
    case 'failed':
      return colors.danger;
    default:
      return colors.textMuted;
  }
}

export default function BroadcastsScreen() {
  const { colors } = useTheme();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['broadcasts'],
    queryFn: async () => {
      // Same direct read as the web list; counts are trigger-maintained
      // columns. RLS is user-scoped: campaigns YOU created.
      const { data: rows, error } = await supabase
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (rows ?? []) as Broadcast[];
    },
    // Live campaigns update their counts continuously.
    refetchInterval: (query) =>
      query.state.data?.some((b) => b.status === 'sending') ? 5000 : false,
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Broadcasts',
        }}
      />
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        data={data ?? []}
        keyExtractor={(b) => b.id}
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
            Campaigns you created. Composing new broadcasts happens on the web app.
          </Text>
        }
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              icon="megaphone-outline"
              title="No campaigns yet"
              subtitle="Broadcasts you create on the web will show their live delivery stats here."
            />
          )
        }
        renderItem={({ item }) => <BroadcastCard broadcast={item} />}
      />
    </View>
  );
}

function BroadcastCard({ broadcast }: { broadcast: Broadcast }) {
  const { colors } = useTheme();
  const delivered = broadcast.delivered_count + broadcast.read_count + broadcast.replied_count;
  const progress =
    broadcast.total_recipients > 0
      ? Math.min(1, broadcast.sent_count / broadcast.total_recipients)
      : 0;

  return (
    <Link href={`/(app)/broadcast/${broadcast.id}`} asChild>
      <Pressable
        style={StyleSheet.flatten([
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ])}
        android_ripple={{ color: colors.border }}
      >
        <View style={styles.cardTop}>
          <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
            {broadcast.name}
          </Text>
          <Text
            style={{
              fontSize: 11.5,
              fontFamily: fonts.bold,
              textTransform: 'uppercase',
              color: statusColor(broadcast.status, colors),
            }}
          >
            {broadcast.status}
          </Text>
        </View>
        <Text style={{ fontSize: 12.5, color: colors.textMuted }} numberOfLines={1}>
          {broadcast.template_name ? `Template: ${broadcast.template_name} · ` : ''}
          {chatListTime(broadcast.scheduled_at ?? broadcast.created_at)}
        </Text>

        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: colors.primary, width: `${progress * 100}%` },
            ]}
          />
        </View>

        <View style={styles.statsRow}>
          <Stat label="Recipients" value={broadcast.total_recipients} />
          <Stat label="Sent" value={broadcast.sent_count} />
          <Stat label="Delivered" value={delivered} />
          <Stat label="Read" value={broadcast.read_count} />
          <Stat label="Failed" value={broadcast.failed_count} danger={broadcast.failed_count > 0} />
        </View>
      </Pressable>
    </Link>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 1 }}>
      <Text
        style={{
          fontSize: 15,
          fontFamily: fonts.extrabold,
          color: danger ? colors.danger : colors.text,
        }}
      >
        {value}
      </Text>
      <Text style={{ fontSize: 10.5, color: colors.textFaint }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: 8,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: { flex: 1, fontSize: 15.5, fontFamily: fonts.bold },
  progressTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
