import { Ionicons } from '@expo/vector-icons';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { ConvoRealLoader } from '@/components/loader';
import { Avatar, EmptyState, FilterChip, PrimaryButton } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import type { Broadcast, BroadcastRecipient } from '@/lib/types';
import { canSendMessages, isAccountRole } from '@shared/lib/auth/roles';
import {
  BROADCAST_DELETE_CONFIRM,
  getRecipientStatus,
  hasRetryableRecipients,
  RECIPIENT_STATUS_FILTERS,
  RETRYABLE_RECIPIENT_STATUSES,
  retryFailedSummary,
  type RetryFailedResult,
} from '@shared/lib/broadcast-status';

type StatusFilter = BroadcastRecipient['status'] | 'all';

const RECIPIENT_PAGE_SIZE = 100;

function recipientColor(
  status: BroadcastRecipient['status'],
  colors: ThemeColors
): string {
  switch (status) {
    case 'read':
    case 'replied':
      return colors.success;
    case 'failed':
    case 'rate_limited':
      return colors.danger;
    case 'pending':
      return colors.textFaint;
    default:
      return colors.textMuted;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function BroadcastDetailScreen() {
  const { colors, fonts: f } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const dialog = useAppDialog();
  const profile = useAuthStore((s) => s.profile);
  const canManage = Boolean(
    profile &&
    isAccountRole(profile.account_role) &&
    canSendMessages(profile.account_role) &&
    !profile.is_read_only
  );

  const { data: broadcast, refetch: refetchBroadcast } = useQuery({
    queryKey: ['broadcast', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('broadcasts')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as Broadcast;
    },
    refetchInterval: (query) =>
      query.state.data?.status === 'sending' ? 5_000 : false,
  });

  const sending = broadcast?.status === 'sending';

  const {
    data: recipientPages,
    isLoading,
    isError: recipientsFailed,
    refetch: refetchRecipients,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['broadcast-recipients', id, filter],
    enabled: Boolean(id),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const from = pageParam * RECIPIENT_PAGE_SIZE;
      let query = supabase
        .from('broadcast_recipients')
        .select('*, contact:contacts(id, name, phone)')
        .eq('broadcast_id', id);
      if (filter !== 'all') query = query.eq('status', filter);
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + RECIPIENT_PAGE_SIZE - 1);
      if (error) throw error;
      return (data ?? []) as BroadcastRecipient[];
    },
    getNextPageParam: (last, pages) =>
      last.length === RECIPIENT_PAGE_SIZE ? pages.length : undefined,
    placeholderData: keepPreviousData,
    refetchInterval: sending ? 15_000 : false,
  });

  const { data: retryableCount = 0, refetch: refetchRetryable } = useQuery({
    queryKey: ['broadcast-retryable', id],
    enabled: Boolean(id) && canManage,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('broadcast_id', id)
        .in('status', [...RETRYABLE_RECIPIENT_STATUSES]);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: sending ? 15_000 : false,
  });

  const pull = usePullRefresh(() =>
    Promise.all([refetchBroadcast(), refetchRecipients(), refetchRetryable()])
  );

  const wasSending = useRef(false);
  useEffect(() => {
    if (wasSending.current && !sending) {
      void refetchRecipients();
      void refetchRetryable();
    }
    wasSending.current = sending;
  }, [sending, refetchRecipients, refetchRetryable]);

  const retryMutation = useMutation({
    mutationFn: () =>
      apiFetch<RetryFailedResult>(`/api/broadcasts/${id}/retry-failed`, {
        method: 'POST',
      }),
    onSuccess: async (result) => {
      await Promise.all([
        refetchBroadcast(),
        queryClient.invalidateQueries({
          queryKey: ['broadcast-recipients', id],
        }),
        refetchRetryable(),
      ]);
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
      dialog.show({
        title: 'Retry complete',
        message: retryFailedSummary(result),
      });
    },
    onError: (err) =>
      dialog.show({
        title: 'Could not retry',
        message: friendlyError(errorText(err)),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('broadcasts')
        .delete()
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('The broadcast is no longer there.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
      router.back();
    },
    onError: (err) =>
      dialog.show({
        title: 'Could not delete broadcast',
        message: friendlyError(errorText(err)),
      }),
  });

  const confirmDelete = () =>
    dialog.show({
      title: BROADCAST_DELETE_CONFIRM,
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: dialog.close },
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: () => {
            dialog.close();
            deleteMutation.mutate();
          },
        },
      ],
    });

  const filtered = recipientPages?.pages.flat() ?? [];
  const total = broadcast?.total_recipients ?? 0;
  const showRetry =
    canManage && (hasRetryableRecipients(filtered) || retryableCount > 0);

  const header = (
    <View style={{ gap: spacing.md, paddingTop: spacing.md }}>
      {broadcast ? (
        <View style={styles.statsGrid}>
          <StatTile label="Total Recipients" value={total} />
          <StatTile label="Sent" value={broadcast.sent_count} total={total} />
          <StatTile
            label="Delivered"
            value={broadcast.delivered_count}
            total={total}
          />
          <StatTile label="Read" value={broadcast.read_count} total={total} />
          <StatTile
            label="Replied"
            value={broadcast.replied_count}
            total={total}
          />
          <StatTile
            label="Failed"
            value={broadcast.failed_count}
            total={total}
            danger={broadcast.failed_count > 0}
          />
        </View>
      ) : null}

      {broadcast && canManage ? (
        <View style={styles.actions}>
          {showRetry ? (
            <ActionButton
              icon="refresh"
              label={retryMutation.isPending ? 'Retrying…' : 'Retry failed'}
              color={colors.warning}
              disabled={retryMutation.isPending || sending}
              onPress={() => retryMutation.mutate()}
            />
          ) : null}
          <ActionButton
            icon="trash-outline"
            label={deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            color={colors.danger}
            disabled={deleteMutation.isPending || sending}
            onPress={confirmDelete}
          />
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
      >
        <FilterChip
          label="All statuses"
          active={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        {RECIPIENT_STATUS_FILTERS.map((s) => (
          <FilterChip
            key={s}
            label={getRecipientStatus(s).label}
            active={filter === s}
            onPress={() => setFilter(s)}
          />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: broadcast?.name ?? 'Broadcast',
        }}
      />

      {isLoading ? (
        <ConvoRealLoader style={{ alignSelf: 'center', marginTop: 40 }} />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={filtered}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={header}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={colors.primary}
            />
          }
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator
                color={colors.primary}
                style={{ paddingVertical: spacing.lg }}
              />
            ) : null
          }
          ListEmptyComponent={
            recipientsFailed ? (
              <EmptyState
                icon="cloud-offline-outline"
                title="Couldn’t load recipients"
                subtitle="Check your connection and try again."
                action={
                  <PrimaryButton
                    label="Retry"
                    icon="refresh"
                    onPress={() => refetchRecipients()}
                  />
                }
              />
            ) : (
              <Text
                style={{
                  textAlign: 'center',
                  marginTop: 40,
                  color: colors.textMuted,
                }}
              >
                No recipients with this status.
              </Text>
            )
          }
          renderItem={({ item }) => {
            const name =
              item.contact?.name || item.contact?.phone || 'Removed contact';
            return (
              <View style={[styles.row, { borderBottomColor: colors.border }]}>
                <Avatar name={name} size={38} />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text
                    style={{
                      fontSize: 14.5,
                      fontFamily: f.semibold,
                      color: colors.text,
                    }}
                  >
                    {name}
                  </Text>
                  {item.error_message ? (
                    <Text
                      style={{ fontSize: 12, color: colors.danger }}
                      numberOfLines={1}
                    >
                      {item.error_message}
                    </Text>
                  ) : null}
                </View>
                <Text
                  style={{
                    fontSize: 11.5,
                    fontFamily: f.bold,
                    color: recipientColor(item.status, colors),
                  }}
                >
                  {getRecipientStatus(item.status).label}
                </Text>
              </View>
            );
          }}
        />
      )}
      <AppDialog {...dialog.dialogProps} />
    </View>
  );
}

function StatTile({
  label,
  value,
  total,
  danger,
}: {
  label: string;
  value: number;
  total?: number;
  danger?: boolean;
}) {
  const { colors, fonts: f } = useTheme();
  const pct =
    total === undefined
      ? null
      : total > 0
        ? Math.round((value / total) * 100)
        : 0;
  return (
    <View
      style={[
        styles.statTile,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <Text
        style={{
          fontSize: 17,
          fontFamily: f.extrabold,
          color: danger ? colors.danger : colors.text,
        }}
      >
        {value.toLocaleString()}
      </Text>
      <Text style={{ fontSize: 11, color: colors.textMuted }} numberOfLines={1}>
        {label}
        {pct !== null ? ` · ${pct}%` : ''}
      </Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  color,
  onPress,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[
        styles.actionButton,
        {
          backgroundColor: colors.glass,
          borderColor: colors.glassBorder,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      android_ripple={{ color: colors.border }}
    >
      <Ionicons name={icon} size={15} color={color} />
      <Text style={{ fontSize: 13, fontFamily: f.semibold, color }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  statTile: {
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  filters: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
