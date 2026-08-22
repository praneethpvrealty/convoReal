import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { ConvoRealLoader } from '@/components/loader';
import { Avatar, SectionLabel, Tag, nameTagCap } from '@/components/ui';
import {
  fetchFocus,
  type FocusJourney,
  type FocusRequest,
  type FocusRequestKind,
  type FocusTask,
} from '@/lib/focus';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';
import {
  fetchExpiringSessions,
  fetchHotGoingQuiet,
  fetchTodayInsights,
} from '@/lib/today';
import { setTodoCompleted } from '@/lib/todos';
import { usePullRefresh } from '@/lib/use-pull-refresh';

/**
 * Web parity: the Focus tab (/dashboard?tab=focus). The day in three
 * answers — tasks and visits, the journeys that need a nudge, the
 * requests waiting on a reply — over the Today signals that have no
 * card of their own: reply windows, cooling leads, and the numbers.
 *
 * The three Focus sections come ranked from GET /api/focus. Nothing
 * here re-orders them. Tapping a row opens the full screen for it;
 * the web expands in place instead, which is the one deliberate
 * divergence — a React Flow canvas has no native counterpart.
 */

const HOUR_MS = 3_600_000;

const REQUEST_ICON: Record<
  FocusRequestKind,
  React.ComponentProps<typeof Ionicons>['name']
> = {
  bid: 'cash-outline',
  listing_submission: 'business-outline',
  inquiry: 'chatbubble-ellipses-outline',
  match: 'radio-outline',
};

const URGENCY_LABEL = {
  now: 'Now',
  soon: 'Soon',
  later: 'When you can',
} as const;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function waitedLabel(hours: number): string {
  if (hours < 1) return 'just now';
  if (hours < 24) return `waiting ${hours}h`;
  const days = Math.floor(hours / 24);
  return `waiting ${days} day${days === 1 ? '' : 's'}`;
}

export default function FocusScreen() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const now = new Date();

  const focus = useQuery({ queryKey: ['focus'], queryFn: fetchFocus });
  const insights = useQuery({
    queryKey: ['today-insights'],
    queryFn: fetchTodayInsights,
  });
  const sessions = useQuery({
    queryKey: ['today-sessions'],
    queryFn: fetchExpiringSessions,
  });
  const quiet = useQuery({
    queryKey: ['today-quiet-hot'],
    queryFn: fetchHotGoingQuiet,
  });

  const pull = usePullRefresh(() =>
    Promise.all([
      focus.refetch(),
      insights.refetch(),
      sessions.refetch(),
      quiet.refetch(),
    ])
  );
  const statWidth = width < 500 ? '47%' : '30%';

  const tasks = focus.data?.tasks;
  const journeys = focus.data?.journeys.top ?? [];
  const requests = focus.data?.requests.top ?? [];

  function openJourney(journey: FocusJourney) {
    if (journey.mode === 'buyer') {
      router.push(`/(app)/journey?contactId=${journey.subjectId}`);
    } else {
      router.push(`/(app)/property/${journey.subjectId}`);
    }
  }

  function openRequest(request: FocusRequest) {
    if (request.kind === 'match') {
      router.push('/(app)/radar');
      return;
    }
    const contactId = request.href.split('contactId=')[1];
    if (request.kind === 'inquiry' && contactId) {
      router.push(`/(app)/contact/${contactId}`);
      return;
    }
    const propertyId = request.href.split('propertyId=')[1];
    if (propertyId) {
      router.push(`/(app)/property/${propertyId}`);
      return;
    }
    router.push('/(app)/(tabs)/properties');
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Focus' }} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <Text style={{ fontSize: 13, color: colors.textMuted }}>
          {now.toLocaleDateString([], {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </Text>

        {focus.isLoading ? (
          <ConvoRealLoader
            style={{ alignSelf: 'center', paddingVertical: 40 }}
          />
        ) : focus.isError ? (
          <QueryState
            text="Focus could not load. Pull to retry."
            onRetry={() => focus.refetch()}
          />
        ) : (
          <>
            <SectionLabel
              text={
                tasks
                  ? `Tasks & visits · ${tasks.visits} visit${tasks.visits === 1 ? '' : 's'}${tasks.overdue > 0 ? ` · ${tasks.overdue} overdue` : ''}`
                  : 'Tasks & visits'
              }
            />
            {(tasks?.items ?? []).length === 0 ? (
              <QuietLine text="Nothing scheduled — the day is yours." />
            ) : (
              (tasks?.items ?? []).map((task) => (
                <TaskRow key={task.id} task={task} />
              ))
            )}

            <SectionLabel
              text="Top journeys"
              style={{ marginTop: spacing.sm }}
            />
            {journeys.length === 0 ? (
              <QuietLine text="No live journeys to rank yet." />
            ) : (
              journeys.map((journey) => (
                <Row
                  key={`${journey.mode}:${journey.subjectId}`}
                  icon={
                    journey.mode === 'buyer'
                      ? 'person-outline'
                      : 'home-outline'
                  }
                  title={journey.subject.name}
                  subtitle={journey.reason}
                  subtitleColor={
                    journey.stalledDays >= 7 ? colors.warning : colors.textMuted
                  }
                  onPress={() => openJourney(journey)}
                />
              ))
            )}

            <SectionLabel
              text="Requests to act on"
              style={{ marginTop: spacing.sm }}
            />
            {requests.length === 0 ? (
              <QuietLine text="Nobody is waiting on you." />
            ) : (
              requests.map((request) => (
                <Row
                  key={request.id}
                  icon={REQUEST_ICON[request.kind]}
                  title={request.title}
                  subtitle={`${URGENCY_LABEL[request.urgency]} · ${waitedLabel(request.ageHours)}`}
                  subtitleColor={
                    request.urgency === 'now'
                      ? colors.danger
                      : request.urgency === 'soon'
                        ? colors.warning
                        : colors.textMuted
                  }
                  onPress={() => openRequest(request)}
                />
              ))
            )}

            <SectionLabel
              text="Reply before the window closes"
              style={{ marginTop: spacing.sm }}
            />
            {sessions.isLoading ? (
              <QueryState text="Loading reply windows…" loading />
            ) : sessions.isError ? (
              <QueryState
                text="Reply windows unavailable. Pull to retry."
                onRetry={() => sessions.refetch()}
              />
            ) : (sessions.data ?? []).length === 0 ? (
              <QuietLine text="Inbox clear — nobody is waiting on a reply." />
            ) : (
              (sessions.data ?? []).slice(0, 10).map((s) => {
                const hoursLeft = Math.max(
                  0,
                  Math.floor(
                    (new Date(s.expiresAt).getTime() - now.getTime()) / HOUR_MS
                  )
                );
                const urgent = hoursLeft < 6;
                const who =
                  s.contact?.name || s.contact?.phone || 'Unknown contact';
                return (
                  <Row
                    key={s.conversationId}
                    title={who}
                    nameTag={s.contact?.name_tag}
                    subtitle={
                      hoursLeft === 0
                        ? 'Window closing now'
                        : `Window closes in ${hoursLeft}h`
                    }
                    subtitleColor={urgent ? colors.danger : colors.textMuted}
                    onPress={() =>
                      router.push(`/(app)/conversation/${s.conversationId}`)
                    }
                  />
                );
              })
            )}

            <SectionLabel
              text="Hot leads going quiet"
              style={{ marginTop: spacing.sm }}
            />
            {quiet.isLoading ? (
              <QueryState text="Loading quiet hot leads…" loading />
            ) : quiet.isError ? (
              <QueryState
                text="Quiet-lead analytics unavailable. Pull to retry."
                onRetry={() => quiet.refetch()}
              />
            ) : (quiet.data ?? []).length === 0 ? (
              <QuietLine text="No hot leads are going cold. Keep it up." />
            ) : (
              (quiet.data ?? []).map((lead) => (
                <Row
                  key={lead.id}
                  title={lead.name || lead.phone || 'Unknown contact'}
                  nameTag={lead.name_tag}
                  subtitle={
                    lead.daysSilent === 0
                      ? 'Not contacted yet'
                      : `Silent for ${lead.daysSilent} day${lead.daysSilent === 1 ? '' : 's'}`
                  }
                  subtitleColor={
                    lead.daysSilent >= 4 ? colors.danger : colors.warning
                  }
                  onPress={() => router.push(`/(app)/contact/${lead.id}`)}
                />
              ))
            )}

            <SectionLabel
              text="Your numbers today"
              style={{ marginTop: spacing.sm }}
            />
            {insights.isLoading ? (
              <QueryState text="Loading today’s numbers…" loading />
            ) : insights.isError ? (
              <QueryState
                text="Today’s numbers unavailable. Pull to retry."
                onRetry={() => insights.refetch()}
              />
            ) : null}
            <View style={styles.grid}>
              <StatCard
                label="New inquiries"
                value={insights.data?.newInquiries}
                width={statWidth}
              />
              <StatCard
                label="New contacts"
                value={insights.data?.newContacts}
                width={statWidth}
              />
              <StatCard
                label="Showcase opens"
                value={insights.data?.showcaseOpens}
                width={statWidth}
              />
              <StatCard
                label="Received"
                value={insights.data?.messagesReceived}
                width={statWidth}
              />
              <StatCard label="Sent" value={insights.data?.messagesSent} width={statWidth} />
              <StatCard
                label="Replied"
                value={
                  insights.data
                    ? `${insights.data.respondedConversations}/${insights.data.inboundConversations}`
                    : undefined
                }
                width={statWidth}
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatCard({
  label,
  value,
  width,
}: {
  label: string;
  value: number | string | undefined;
  width: `${number}%`;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View
      style={[
        styles.stat,
        { width },
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <Text
        style={{ fontSize: 21, fontFamily: f.extrabold, color: colors.text }}
      >
        {value ?? '…'}
      </Text>
      <Text style={{ fontSize: 11.5, color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

function QueryState({
  text,
  loading = false,
  onRetry,
}: {
  text: string;
  loading?: boolean;
  onRetry?: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.status, { borderColor: colors.border }]}
    >
      {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      <Text style={{ flex: 1, fontSize: 12, color: colors.textMuted }}>
        {text}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry loading this section"
        >
          <Text style={{ fontSize: 12, fontFamily: f.bold, color: colors.primary }}>
            Retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Row({
  icon,
  title,
  nameTag,
  subtitle,
  subtitleColor,
  onPress,
}: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  nameTag?: string | null;
  subtitle: string;
  subtitleColor?: string;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[
        styles.row,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      {icon ? (
        <View
          style={[styles.rowBadge, { backgroundColor: colors.primarySoft }]}
        >
          <Ionicons name={icon} size={17} color={colors.primary} />
        </View>
      ) : (
        <Avatar name={title} size={38} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
          }}
        >
          <Text
            style={{
              fontSize: 14.5,
              fontFamily: f.semibold,
              color: colors.text,
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {title}
          </Text>
          {nameTag ? (
            <View style={nameTagCap}>
              <Tag label={nameTag} />
            </View>
          ) : null}
        </View>
        <Text
          style={{ fontSize: 12.5, color: subtitleColor ?? colors.textMuted }}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

/** An appointment reads as a row; a to-do carries an inline complete
 *  toggle, the one action worth having without leaving Focus. */
function TaskRow({ task }: { task: FocusTask }) {
  const { colors, fonts: f } = useTheme();
  const [busy, setBusy] = useState(false);

  async function complete() {
    haptic.tap();
    setBusy(true);
    try {
      await setTodoCompleted(task.id, true);
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['focus'] });
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    } catch {
      haptic.warn();
      setBusy(false);
    }
  }

  const subtitle = [
    task.overdue ? 'Overdue' : timeLabel(task.at),
    task.location,
    task.contact?.name,
    task.property?.name,
  ]
    .filter(Boolean)
    .join(' · ');

  if (task.kind === 'appointment') {
    return (
      <Row
        icon={task.location ? 'location-outline' : 'calendar-outline'}
        title={task.title}
        subtitle={subtitle}
        subtitleColor={task.overdue ? colors.danger : colors.textMuted}
        onPress={() => router.push('/(app)/(tabs)/calendar')}
      />
    );
  }

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <Pressable
        onPress={complete}
        disabled={busy}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: false }}
        accessibilityLabel={`Complete ${task.title}`}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name="ellipse-outline" size={24} color={colors.primary} />
        )}
      </Pressable>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{ fontSize: 14.5, fontFamily: f.semibold, color: colors.text }}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        <Text
          style={{
            fontSize: 12.5,
            color: task.overdue ? colors.danger : colors.textMuted,
          }}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

function QuietLine({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <Text
      style={[
        styles.quiet,
        { color: colors.textFaint, borderColor: colors.border },
      ]}
    >
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    borderWidth: 1,
    gap: 2,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  quiet: {
    fontSize: 12.5,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  row: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  rowBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
