import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog } from '@/components/app-dialog';
import { LoadErrorState } from '@/components/load-error';
import { ConvoRealLoader } from '@/components/loader';
import { Avatar, EmptyState } from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api';
import {
  CALL_BACKS_QUERY_KEY,
  fetchCallBacks,
  type CallBack,
} from '@/lib/call-backs';
import { useAuthStore } from '@/lib/auth-store';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useCallLog } from '@/lib/use-call-log';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import {
  CALL_BACK_EVENT_TYPE,
  groupCallBacks,
  type CallBackBucket,
} from '@shared/lib/calendar/call-backs';

function callTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export default function CallBacksScreen() {
  const { colors, fonts: f } = useTheme();
  const { dial, callLogProps } = useCallLog();
  const canEdit = useAuthStore((s) =>
    Boolean(
      s.profile &&
      s.profile.account_role !== 'viewer' &&
      !s.profile.is_read_only
    )
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: CALL_BACKS_QUERY_KEY,
    queryFn: fetchCallBacks,
  });
  const pull = usePullRefresh(refetch);
  const sections = useMemo(
    () =>
      groupCallBacks(data ?? [], new Date()).map((group) => ({
        key: group.bucket,
        title: `${group.label} (${group.items.length})`,
        data: group.items,
      })),
    [data]
  );

  async function markDone(callBack: CallBack) {
    setBusyId(callBack.id);
    try {
      await apiFetch(`/api/appointments/${callBack.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'completed' }),
      });
      haptic.success();
      queryClient.setQueryData<CallBack[]>(CALL_BACKS_QUERY_KEY, (current) =>
        current?.filter((c) => c.id !== callBack.id)
      );
      queryClient.invalidateQueries({
        queryKey: ['appointments'],
        predicate: (q) => q.queryKey[1] !== CALL_BACKS_QUERY_KEY[1],
      });
    } catch (err) {
      haptic.warn();
      setError(
        err instanceof ApiError ? err.message : 'Could not mark it done.'
      );
    } finally {
      setBusyId(null);
    }
  }

  function call(callBack: CallBack) {
    const contact = callBack.contact;
    if (!contact?.phone) return;
    dial(
      { id: contact.id, name: contact.name, phone: contact.phone },
      {
        onLogged: (outcome) => {
          if (outcome === 'connected') void markDone(callBack);
        },
      }
    );
  }

  const bucketColor = (bucket: CallBackBucket) =>
    bucket === 'overdue'
      ? colors.danger
      : bucket === 'today'
        ? colors.warning
        : colors.textMuted;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Call backs',
          headerRight: () =>
            canEdit ? (
              <Pressable
                onPress={() => {
                  haptic.tap();
                  router.push({
                    pathname: '/(app)/appointment-new',
                    params: { eventType: CALL_BACK_EVENT_TYPE },
                  });
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Schedule a call"
              >
                <Ionicons name="add-circle" size={28} color={colors.primary} />
              </Pressable>
            ) : null,
        }}
      />
      {isLoading ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <ConvoRealLoader />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(c) => c.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={[
            styles.list,
            sections.length === 0 && { flexGrow: 1 },
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
                title="Couldn’t load call backs"
                onRetry={() => void refetch()}
              />
            ) : (
              <EmptyState
                icon="call-outline"
                title="No call backs"
                subtitle="Tap a contact's call button and choose Schedule call to plan one."
              />
            )
          }
          renderSectionHeader={({ section }) => (
            <Text
              style={[
                styles.sectionTitle,
                {
                  color: bucketColor(section.key as CallBackBucket),
                  fontFamily: f.bold,
                },
              ]}
            >
              {section.title}
            </Text>
          )}
          renderItem={({ item, section }) => {
            const name = item.contact?.name || item.contact?.phone || '';
            const busy = busyId === item.id;
            return (
              <Pressable
                onPress={() => {
                  haptic.tap();
                  router.push(
                    `/(app)/(tabs)/calendar?eventId=${encodeURIComponent(item.id)}`
                  );
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.title}`}
                style={[
                  styles.row,
                  {
                    backgroundColor: colors.glass,
                    borderColor: colors.glassBorder,
                  },
                ]}
              >
                <Avatar name={name || item.title} size={40} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 15,
                      fontFamily: f.bold,
                      color: colors.text,
                    }}
                  >
                    {name || item.title}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12.5,
                      fontFamily: f.semibold,
                      color: bucketColor(section.key as CallBackBucket),
                    }}
                  >
                    {callTime(item.start_time)}
                  </Text>
                  {item.agenda ? (
                    <Text
                      numberOfLines={2}
                      style={{ fontSize: 12.5, color: colors.textMuted }}
                    >
                      {item.agenda}
                    </Text>
                  ) : item.contact?.phone ? (
                    <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                      {item.contact.phone}
                    </Text>
                  ) : null}
                </View>
                {canEdit ? (
                  <Pressable
                    onPress={() => void markDone(item)}
                    disabled={busy}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Mark the call to ${name} done`}
                    style={[
                      styles.action,
                      {
                        backgroundColor: colors.glass,
                        borderColor: colors.glassBorder,
                        borderWidth: 1,
                      },
                    ]}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Ionicons
                        name="checkmark"
                        size={20}
                        color={colors.textMuted}
                      />
                    )}
                  </Pressable>
                ) : null}
                {item.contact?.phone && canEdit ? (
                  <Pressable
                    onPress={() => call(item)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${name}`}
                    style={[styles.action, { backgroundColor: colors.primary }]}
                  >
                    <Ionicons name="call" size={18} color={colors.onPrimary} />
                  </Pressable>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
      <AppDialog {...callLogProps} />
      <AppDialog
        visible={error !== null}
        onClose={() => setError(null)}
        title="Could not update"
        message={error ?? undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.sm },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  action: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
