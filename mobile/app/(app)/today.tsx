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
} from 'react-native';

import { ConvoRealLoader } from '@/components/loader';
import { Avatar, SectionLabel, Tag } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';
import {
  fetchExpiringSessions,
  fetchHotGoingQuiet,
  fetchTodayInsights,
  fetchTodaysAgenda,
} from '@/lib/today';
import { setTodoCompleted, type Todo } from '@/lib/todos';
import { usePullRefresh } from '@/lib/use-pull-refresh';

/**
 * Web parity: the "Today" command-center tab. One screen for the day's
 * action list — WhatsApp windows about to close, hot leads going quiet,
 * today's appointments and due to-dos, and the day's numbers. The
 * web's streak flame and custom date ranges stay web-only.
 */

const HOUR_MS = 3_600_000;

export default function TodayScreen() {
  const { colors } = useTheme();
  const now = new Date();

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
  const agenda = useQuery({
    queryKey: ['today-agenda'],
    queryFn: fetchTodaysAgenda,
  });

  const loading =
    insights.isLoading ||
    sessions.isLoading ||
    quiet.isLoading ||
    agenda.isLoading;
  const pull = usePullRefresh(() =>
    Promise.all([
      insights.refetch(),
      sessions.refetch(),
      quiet.refetch(),
      agenda.refetch(),
    ])
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Today' }} />

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

        {loading ? (
          <ConvoRealLoader
            style={{ alignSelf: 'center', paddingVertical: 40 }}
          />
        ) : (
          <>
            <View style={styles.grid}>
              <StatCard
                label="New inquiries"
                value={insights.data?.newInquiries}
              />
              <StatCard
                label="New contacts"
                value={insights.data?.newContacts}
              />
              <StatCard
                label="Showcase opens"
                value={insights.data?.showcaseOpens}
              />
              <StatCard
                label="Received"
                value={insights.data?.messagesReceived}
              />
              <StatCard label="Sent" value={insights.data?.messagesSent} />
              <StatCard
                label="Replied"
                value={
                  insights.data
                    ? `${insights.data.respondedConversations}/${insights.data.inboundConversations}`
                    : undefined
                }
              />
            </View>

            <SectionLabel
              text="Reply before the window closes"
              style={{ marginTop: spacing.sm }}
            />
            {(sessions.data ?? []).length === 0 ? (
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
            {(quiet.data ?? []).length === 0 ? (
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
              text="Today's agenda"
              style={{ marginTop: spacing.sm }}
            />
            {(agenda.data?.appointments ?? []).length === 0 &&
            (agenda.data?.todos ?? []).length === 0 ? (
              <QuietLine text="Nothing scheduled for today." />
            ) : (
              <>
                {(agenda.data?.appointments ?? []).map((appt) => (
                  <Row
                    key={appt.id}
                    icon="calendar-outline"
                    title={appt.title}
                    subtitle={[
                      new Date(appt.start_time).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                      appt.contact
                        ? appt.contact.name || appt.contact.phone
                        : null,
                      appt.location,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    onPress={() => router.push('/(app)/(tabs)/calendar')}
                  />
                ))}
                {(agenda.data?.todos ?? []).map((todo) => (
                  <AgendaTodoRow key={todo.id} todo={todo} now={now} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number | string | undefined;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View
      style={[
        styles.stat,
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
          {nameTag ? <Tag label={nameTag} /> : null}
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

/** A due (or overdue) to-do with an inline complete toggle. */
function AgendaTodoRow({ todo, now }: { todo: Todo; now: Date }) {
  const { colors, fonts: f } = useTheme();
  const [busy, setBusy] = useState(false);
  const due = todo.due_date ? new Date(todo.due_date) : null;
  const overdue = due !== null && due.getTime() < now.getTime();

  async function complete() {
    haptic.tap();
    setBusy(true);
    try {
      await setTodoCompleted(todo.id, true);
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['today-agenda'] });
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    } catch {
      haptic.warn();
      setBusy(false);
    }
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
        accessibilityLabel={`Complete ${todo.title}`}
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
          {todo.title}
        </Text>
        <Text
          style={{
            fontSize: 12.5,
            color: overdue ? colors.danger : colors.textMuted,
          }}
          numberOfLines={1}
        >
          {overdue ? 'Overdue · ' : 'Due '}
          {due
            ? `${due.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : ''}
          {todo.contact ? ` · ${todo.contact.name || todo.contact.phone}` : ''}
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
    flexGrow: 1,
    flexBasis: '30%',
    gap: 2,
    borderRadius: radius.lg,
    padding: spacing.md,
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
