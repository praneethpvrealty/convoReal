import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EnterRow, PressScale } from '@/components/motion';
import { Banner, EmptyState, FilterChip } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { closeGap, fetchGaps } from '@/lib/gaps';
import {
  GAP_ICON,
  GAP_LABEL,
  countByKind,
  relativeDay,
  sortGaps,
  type ConversationGap,
  type GapKind,
  type GapSeverity,
} from '@/lib/gaps-feed';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';
import { usePullRefresh } from '@/lib/use-pull-refresh';

/**
 * Web parity: the Gaps tab on the dashboard.
 *
 * What the 6am sweep found and nobody has dealt with yet — questions
 * that went unanswered, things that were promised, conversations
 * tracked nowhere. Every judgement about what counts lives server-side
 * in src/lib/sweep/; this screen reads, orders and closes.
 */
export default function GapsScreen() {
  const { colors } = useTheme();
  const accountId = useAuthStore((s) => s.profile?.account_id);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<GapKind | 'all'>('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const gapsQuery = useQuery({
    queryKey: ['conversation-gaps'],
    enabled: Boolean(accountId),
    queryFn: fetchGaps,
  });

  const close = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: 'resolved' | 'dismissed';
    }) => closeGap(id, status),
    onSuccess: (_data, variables) => {
      haptic.success();
      setError(null);
      setNotice(
        variables.status === 'resolved' ? 'Marked done.' : 'Dismissed.'
      );
      queryClient.invalidateQueries({ queryKey: ['conversation-gaps'] });
    },
    onError: () => {
      setNotice(null);
      setError('Could not update this gap.');
    },
  });

  const gaps = useMemo(() => gapsQuery.data ?? [], [gapsQuery.data]);
  const counts = useMemo(() => countByKind(gaps), [gaps]);
  const visible = useMemo(
    () =>
      sortGaps(filter === 'all' ? gaps : gaps.filter((g) => g.kind === filter)),
    [gaps, filter]
  );

  const pull = usePullRefresh(() => gapsQuery.refetch());

  const severityColor = (severity: GapSeverity): string =>
    severity === 'high'
      ? colors.danger
      : severity === 'medium'
        ? colors.warning
        : colors.textFaint;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{ headerShown: true, title: 'Conversation gaps' }}
      />

      <FlatList
        data={visible}
        keyExtractor={(gap) => gap.id}
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
            <Text
              style={{ fontSize: 13, lineHeight: 19, color: colors.textMuted }}
            >
              Every morning the Engine reads back over the last day of WhatsApp
              and lists what got dropped. Nothing here has messaged anyone.
            </Text>

            {error ? <Banner kind="error" text={error} /> : null}
            {notice ? <Banner kind="success" text={notice} /> : null}

            {gaps.length > 0 && (
              <View style={styles.filters}>
                <FilterChip
                  label={`All ${gaps.length}`}
                  active={filter === 'all'}
                  onPress={() => setFilter('all')}
                />
                {counts.map((entry) => (
                  <FilterChip
                    key={entry.kind}
                    label={`${GAP_LABEL[entry.kind]} ${entry.count}`}
                    active={filter === entry.kind}
                    onPress={() => setFilter(entry.kind)}
                  />
                ))}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          gapsQuery.isLoading ? null : (
            <EmptyState
              icon="checkmark-circle-outline"
              title="Nothing dropped"
              subtitle="The last sweep found no unanswered questions, unkept promises or untracked conversations."
            />
          )
        }
        renderItem={({ item, index }) => (
          <EnterRow index={index}>
            <GapCard
              gap={item}
              accent={severityColor(item.severity)}
              busy={close.isPending && close.variables?.id === item.id}
              onResolve={() =>
                close.mutate({ id: item.id, status: 'resolved' })
              }
              onDismiss={() =>
                close.mutate({ id: item.id, status: 'dismissed' })
              }
              onOpen={
                item.conversation_id
                  ? () =>
                      router.push(`/(app)/conversation/${item.conversation_id}`)
                  : undefined
              }
            />
          </EnterRow>
        )}
      />
    </View>
  );
}

function GapCard({
  gap,
  accent,
  busy,
  onResolve,
  onDismiss,
  onOpen,
}: {
  gap: ConversationGap;
  accent: string;
  busy: boolean;
  onResolve: () => void;
  onDismiss: () => void;
  onOpen?: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={[styles.iconWrap, { borderColor: accent }]}>
          <Ionicons
            name={GAP_ICON[gap.kind] as never}
            size={16}
            color={accent}
          />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.summary, { color: colors.text }]}>
            {gap.summary}
          </Text>
          <Text style={[styles.meta, { color: colors.textFaint }]}>
            {GAP_LABEL[gap.kind]} · {relativeDay(gap.occurred_at)}
            {gap.occurrence_count > 1
              ? ` · ${gap.occurrence_count} days running`
              : ''}
            {gap.channel === 'personal_whatsapp' ? ' · your WhatsApp' : ''}
          </Text>
        </View>
      </View>

      {/* The quote, not the model's reading of it — this is what is
          actually being judged. */}
      <Text
        style={[
          styles.evidence,
          { color: colors.textMuted, borderLeftColor: colors.border },
        ]}
      >
        {gap.evidence}
      </Text>

      {gap.suggested_action ? (
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          Suggested: {gap.suggested_action}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {onOpen ? (
          <PressScale onPress={onOpen}>
            <Text style={[styles.link, { color: colors.primary }]}>
              Open conversation
            </Text>
          </PressScale>
        ) : (
          <View />
        )}

        <View style={styles.buttons}>
          <Pressable
            disabled={busy}
            onPress={onDismiss}
            hitSlop={8}
            style={[styles.button, { borderColor: colors.border }]}
          >
            <Ionicons name="close" size={16} color={colors.textFaint} />
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={onResolve}
            hitSlop={8}
            style={[styles.button, { borderColor: colors.border }]}
          >
            <Ionicons name="checkmark" size={16} color={colors.success} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  cardTop: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  meta: { fontSize: 11, marginTop: 2, lineHeight: 16 },
  evidence: {
    fontSize: 12,
    lineHeight: 18,
    borderLeftWidth: 2,
    paddingLeft: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  link: { fontSize: 12, fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: spacing.xs },
  button: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
