import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { Confetti, EnterRow } from '@/components/motion';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import {
  Avatar,
  ConversationSkeleton,
  EmptyState,
  FilterChip,
  PrimaryButton,
  TextField,
} from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { contactFullName } from '@/lib/contact-name';
import {
  isClosingRecord,
  transactionSubtitle,
  transactionTitle,
  type TransactionIndexRow,
} from '@/lib/deal-workspace';
import { moveDealStage } from '@/lib/deal-workspace-api';
import { friendlyError } from '@/lib/errors';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import {
  dealStatusForStage,
  isBrokeragePaidStage,
  isBrokeragePendingStage,
  needsBrokerageCapture,
  pipelineOutcomeForStage,
  type PipelineOutcome,
} from '@/lib/stage-semantics';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme, fonts } from '@/lib/theme';
import type { Deal, Pipeline, PipelineStage } from '@/lib/types';
import { usePullRefresh } from '@/lib/use-pull-refresh';

import { JourneyBody } from './journey';

function dealIndexRow(deal: Deal) {
  return {
    title: deal.title,
    contact_name: deal.contact ? contactFullName(deal.contact) || null : null,
    property_title: deal.property?.title ?? null,
    property_unit_no: deal.property?.unit_no ?? null,
    source_journey_item_id: deal.source_journey_item_id ?? null,
    milestones_total: deal.milestones?.[0]?.count ?? 0,
  };
}

/**
 * What a deal's brokerage is worth.
 *
 * `brokerage_amount` is what the agent actually agreed; the fallback
 * recomputes it from the rate rather than assuming a flat 2%, which is
 * what this screen used to guess and what made its stage totals
 * disagree with the invoice raised off the same deal. Mirrors
 * `src/lib/pipelines/brokerage.ts` — guarded by mobile-parity.test.ts.
 */
function brokeragePreview(
  dealValue: number | null,
  type: 'percentage' | 'fixed',
  raw: string
): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return type === 'fixed' ? value : ((dealValue ?? 0) * value) / 100;
}

function dealBrokerage(deal: Deal): number {
  if (deal.brokerage_amount != null) return Number(deal.brokerage_amount);
  const value = Number(deal.brokerage_value ?? 0);
  if (value <= 0) return 0;
  if (deal.brokerage_type === 'fixed') return value;
  return (Number(deal.value ?? 0) * value) / 100;
}

export default function DealsScreen() {
  const { colors, fonts: f } = useTheme();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [outcomeView, setOutcomeView] = useState<PipelineOutcome>('active');
  const [movingDeal, setMovingDeal] = useState<Deal | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [brokeragePrompt, setBrokeragePrompt] = useState<{
    deal: Deal;
    stage: PipelineStage;
  } | null>(null);
  const [brokerageType, setBrokerageType] = useState<'percentage' | 'fixed'>(
    'percentage'
  );
  const [brokerageValue, setBrokerageValue] = useState('');
  const [segment, setSegment] = useState<'board' | 'journey' | 'records'>(
    'board'
  );
  const profile = useAuthStore((s) => s.profile);
  const accountId = profile?.account_id ?? null;

  const recordsQuery = useQuery({
    queryKey: ['transaction-index', accountId],
    enabled: segment === 'records' && Boolean(accountId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'transaction_workspace_index',
        {
          target_account_id: accountId!,
        }
      );
      if (error) throw error;
      return ((data ?? []) as TransactionIndexRow[]).filter(isClosingRecord);
    },
  });

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipelines')
        .select('id, name')
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as Pipeline[];
    },
  });
  const activePipeline = pipelineId ?? pipelines?.[0]?.id ?? null;

  const { data: stages } = useQuery({
    queryKey: ['pipeline-stages', activePipeline],
    enabled: Boolean(activePipeline),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', activePipeline!)
        .order('position');
      if (error) throw error;
      return (data ?? []) as PipelineStage[];
    },
  });

  const {
    data: deals,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['deals', activePipeline],
    enabled: Boolean(activePipeline),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deals')
        .select(
          '*, contact:contacts(id, name, second_name, phone), property:properties(id, title, unit_no), milestones:deal_milestones(count)'
        )
        .eq('pipeline_id', activePipeline!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Deal[];
    },
  });
  const pull = usePullRefresh(refetch);
  const { show, dialogProps } = useAppDialog();

  const stageById = useMemo(
    () => new Map((stages ?? []).map((stage) => [stage.id, stage])),
    [stages]
  );
  const outcomeCounts = useMemo(() => {
    const counts: Record<PipelineOutcome, number> = {
      active: 0,
      successful: 0,
      lost: 0,
    };
    for (const deal of deals ?? []) {
      const stage = stageById.get(deal.stage_id);
      if (stage) counts[pipelineOutcomeForStage(stage.name)] += 1;
    }
    return counts;
  }, [deals, stageById]);

  const visibleStages = useMemo(
    () =>
      (stages ?? []).filter(
        (stage) => pipelineOutcomeForStage(stage.name) === outcomeView
      ),
    [stages, outcomeView]
  );
  const activeStage =
    visibleStages.find((stage) => stage.id === stageId)?.id ??
    visibleStages[0]?.id ??
    null;
  const stageDeals = useMemo(
    () => (deals ?? []).filter((d) => d.stage_id === activeStage),
    [deals, activeStage]
  );
  const stageValue = stageDeals.reduce((sum, d) => sum + (d.value ?? 0), 0);
  const stageBrokerage = stageDeals.reduce(
    (sum, deal) => sum + dealBrokerage(deal),
    0
  );
  const selectedStage = (stages ?? []).find(
    (stage) => stage.id === activeStage
  );

  async function moveDeal(
    deal: Deal,
    stage: PipelineStage,
    brokerage?: {
      brokerage_type: 'percentage' | 'fixed';
      brokerage_value: number;
    }
  ) {
    setMovingDeal(null);
    setBrokeragePrompt(null);
    if (
      !brokerage &&
      needsBrokerageCapture(
        { brokerage_amount: deal.brokerage_amount ?? null },
        stage.name
      )
    ) {
      setBrokerageType('percentage');
      setBrokerageValue('');
      setBrokeragePrompt({ deal, stage });
      return;
    }
    if (isBrokeragePaidStage(stage.name)) {
      haptic.success();
      setCelebrating(true);
    } else {
      haptic.tap();
    }
    try {
      await moveDealStage(deal.id, {
        status: dealStatusForStage(stage.name),
        target_stage_id: stage.id,
        property_id: deal.property_id ?? null,
        current_stage_name: stage.name,
        ...brokerage,
      });
    } catch (err) {
      haptic.warn();
      show({
        title: 'Could not move deal',
        message: friendlyError(
          err instanceof Error ? err.message : String(err)
        ),
      });
      return;
    }
    setOutcomeView(pipelineOutcomeForStage(stage.name));
    setStageId(stage.id);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['deals', activePipeline] }),
      queryClient.invalidateQueries({ queryKey: ['transaction-index'] }),
    ]);
  }

  async function reopenDeal(deal: Deal) {
    const orderedStages = [...(stages ?? [])].sort(
      (a, b) => a.position - b.position
    );
    const target =
      orderedStages.find((stage) => isBrokeragePendingStage(stage.name)) ??
      [...orderedStages]
        .reverse()
        .find(
          (stage) =>
            pipelineOutcomeForStage(stage.name) === 'successful' &&
            !isBrokeragePaidStage(stage.name)
        );
    if (!target) {
      show({
        title: 'Could not reopen deal',
        message: 'Add a Brokerage Pending stage and try again.',
      });
      return;
    }
    await moveDeal(deal, target);
  }

  return (
    <View style={{ flex: 1 }}>
      <AppDialog {...dialogProps} />
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Deals',
          headerRight: () =>
            segment === 'board' && activePipeline ? (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/(app)/deal-edit',
                    params: {
                      pipelineId: activePipeline,
                      ...(activeStage ? { stageId: activeStage } : {}),
                    },
                  })
                }
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="New deal"
              >
                <Ionicons name="add-circle" size={28} color={colors.primary} />
              </Pressable>
            ) : null,
        }}
      />

      <View style={styles.outcomeRow}>
        <FilterChip
          label="Board"
          active={segment === 'board'}
          onPress={() => setSegment('board')}
        />
        <FilterChip
          label="Journey"
          active={segment === 'journey'}
          onPress={() => setSegment('journey')}
        />
        <FilterChip
          label="Records"
          active={segment === 'records'}
          onPress={() => setSegment('records')}
        />
      </View>

      {segment === 'journey' ? <JourneyBody /> : null}

      {segment === 'records' ? (
        <RecordsList
          rows={recordsQuery.data ?? []}
          loading={recordsQuery.isLoading}
          refreshing={recordsQuery.isRefetching}
          onRefresh={() => void recordsQuery.refetch()}
        />
      ) : null}

      {segment === 'board' && pipelines && pipelines.length > 1 ? (
        <View style={styles.header}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {pipelines.map((p) => (
                <FilterChip
                  key={p.id}
                  label={p.name}
                  active={p.id === activePipeline}
                  onPress={() => {
                    setPipelineId(p.id);
                    setStageId(null);
                    setOutcomeView('active');
                  }}
                />
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {segment === 'board' ? (
        <View style={styles.outcomeRow}>
          {(
            [
              ['active', 'Active'],
              ['successful', 'Successful'],
              ['lost', 'Lost'],
            ] as const
          ).map(([outcome, label]) => {
            const count = outcomeCounts[outcome];
            return (
              <FilterChip
                key={outcome}
                label={`${label}${count ? ` (${count})` : ''}`}
                active={outcome === outcomeView}
                onPress={() => {
                  setOutcomeView(outcome);
                  setStageId(null);
                }}
              />
            );
          })}
        </View>
      ) : null}

      {/* Stage strip — the mobile take on kanban columns. */}
      {segment === 'board' ? (
        <View style={styles.filtersRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {visibleStages.map((s) => {
              const count = (deals ?? []).filter(
                (d) => d.stage_id === s.id
              ).length;
              return (
                <FilterChip
                  key={s.id}
                  label={`${s.name}${count ? ` (${count})` : ''}`}
                  active={s.id === activeStage}
                  onPress={() => setStageId(s.id)}
                />
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {segment === 'board' && stageDeals.length > 0 ? (
        <Text style={[styles.stageSummary, { color: colors.textMuted }]}>
          {stageDeals.length} deal{stageDeals.length === 1 ? '' : 's'} ·{' '}
          {selectedStage && isBrokeragePaidStage(selectedStage.name)
            ? `Brokerage received ${formatInr(stageBrokerage)}`
            : formatInr(stageValue)}
        </Text>
      ) : null}

      {segment !== 'board' ? null : isLoading ? (
        <View>
          {Array.from({ length: 5 }, (_, i) => (
            <ConversationSkeleton key={i} />
          ))}
        </View>
      ) : !pipelines?.length ? (
        <EmptyState
          icon="trending-up-outline"
          title="No pipeline yet"
          subtitle="Create your first sales pipeline on the web app — deals will show up here."
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={stageDeals}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="file-tray-outline"
              title="No deals in this stage"
              subtitle="Move a deal here or switch stages above."
            />
          }
          renderItem={({ item, index }) => (
            <EnterRow index={index}>
              <DealCard
                deal={item}
                stage={selectedStage ?? null}
                onMove={() => setMovingDeal(item)}
                onReopen={() => void reopenDeal(item)}
                onEdit={() =>
                  router.push({
                    pathname: '/(app)/deal-edit',
                    params: { id: item.id },
                  })
                }
              />
            </EnterRow>
          )}
        />
      )}

      {celebrating ? <Confetti onDone={() => setCelebrating(false)} /> : null}

      <BottomSheet
        visible={brokeragePrompt !== null}
        onClose={() => setBrokeragePrompt(null)}
      >
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            Enter brokerage details
          </Text>
        </View>
        <View style={styles.brokerageForm}>
          <Text style={{ fontSize: 13, color: colors.textMuted }}>
            Moving to {brokeragePrompt?.stage.name} starts the closing stretch.
            Record the brokerage rate or amount first.
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <FilterChip
              label="Percentage (%)"
              active={brokerageType === 'percentage'}
              onPress={() => setBrokerageType('percentage')}
            />
            <FilterChip
              label="Fixed amount"
              active={brokerageType === 'fixed'}
              onPress={() => setBrokerageType('fixed')}
            />
          </View>
          <TextField
            label={
              brokerageType === 'percentage'
                ? 'Brokerage (%)'
                : 'Brokerage amount'
            }
            value={brokerageValue}
            onChangeText={setBrokerageValue}
            keyboardType="decimal-pad"
            placeholder={brokerageType === 'percentage' ? '2' : '0'}
          />
          {brokeragePreview(
            brokeragePrompt?.deal.value ?? null,
            brokerageType,
            brokerageValue
          ) > 0 ? (
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: f.bold,
                color: colors.primary,
              }}
            >
              Calculated brokerage:{' '}
              {formatInr(
                brokeragePreview(
                  brokeragePrompt?.deal.value ?? null,
                  brokerageType,
                  brokerageValue
                )
              )}
            </Text>
          ) : null}
          <PrimaryButton
            label="Save and move"
            disabled={!(Number(brokerageValue) > 0)}
            onPress={() =>
              brokeragePrompt &&
              void moveDeal(brokeragePrompt.deal, brokeragePrompt.stage, {
                brokerage_type: brokerageType,
                brokerage_value: Number(brokerageValue),
              })
            }
          />
        </View>
      </BottomSheet>

      {/* Stage picker for the deal being moved. */}
      <BottomSheet
        visible={Boolean(movingDeal)}
        onClose={() => setMovingDeal(null)}
      >
        <View style={styles.modalHeader}>
          <Text
            style={[styles.modalTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            Move “{movingDeal?.title}” to…
          </Text>
          <Pressable
            onPress={() => setMovingDeal(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
        <ScrollView style={sheetScrollArea}>
          {(stages ?? [])
            .filter((s) => s.id !== movingDeal?.stage_id)
            .map((s) => (
              <Pressable
                key={s.id}
                style={[styles.modalRow, { borderTopColor: colors.border }]}
                onPress={() => movingDeal && moveDeal(movingDeal, s)}
                accessibilityRole="button"
                accessibilityLabel={`Move to ${s.name}`}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: s.color || colors.primary,
                  }}
                />
                <Text
                  style={{
                    fontSize: 15,
                    fontFamily: f.semibold,
                    color: colors.text,
                  }}
                >
                  {s.name}
                </Text>
              </Pressable>
            ))}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

function RecordsList({
  rows,
  loading,
  refreshing,
  onRefresh,
}: {
  rows: TransactionIndexRow[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  if (loading) {
    return (
      <View>
        {Array.from({ length: 4 }, (_, i) => (
          <ConversationSkeleton key={i} />
        ))}
      </View>
    );
  }
  return (
    <FlatList
      style={{ flex: 1 }}
      data={rows}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
      ListEmptyComponent={
        <EmptyState
          icon="briefcase-outline"
          title="No records yet"
          subtitle="A record starts when a deal reaches Negotiation/Token or later, or when a journey is converted."
        />
      }
      renderItem={({ item, index }) => {
        const subtitle = transactionSubtitle(item);
        return (
          <EnterRow index={index}>
            <Pressable
              onPress={() => router.push(`/deal/${item.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open the record for ${transactionTitle(item)}`}
              style={[
                styles.card,
                {
                  backgroundColor: colors.glass,
                  borderColor: colors.glassBorder,
                },
              ]}
            >
              <Text
                style={[styles.cardTitle, { color: colors.text }]}
                numberOfLines={2}
              >
                {transactionTitle(item)}
              </Text>
              {subtitle ? (
                <Text
                  style={{ fontSize: 12.5, color: colors.textMuted }}
                  numberOfLines={1}
                >
                  {subtitle}
                </Text>
              ) : null}
              <View style={styles.cardBottom}>
                <Text
                  style={{
                    fontSize: 12,
                    color: item.stage_color ?? colors.textMuted,
                  }}
                >
                  {item.stage_name ?? '—'}
                </Text>
                <Text
                  style={{
                    fontSize: 14,
                    fontFamily: f.extrabold,
                    color: colors.primary,
                  }}
                >
                  {formatInr(item.value)}
                </Text>
              </View>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>
                {`${item.milestones_done}/${item.milestones_total} milestones${item.next_milestone_title ? ` · Next: ${item.next_milestone_title}` : ''}`}
              </Text>
            </Pressable>
          </EnterRow>
        );
      }}
    />
  );
}

function DealCard({
  deal,
  stage,
  onMove,
  onReopen,
  onEdit,
}: {
  deal: Deal;
  stage: PipelineStage | null;
  onMove: () => void;
  onReopen: () => void;
  onEdit: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const contactName = deal.contact?.name || deal.contact?.phone;
  const brokeragePaid = stage ? isBrokeragePaidStage(stage.name) : false;
  const indexRow = dealIndexRow(deal);
  const headline = transactionTitle(indexRow);
  const subtitle = transactionSubtitle(indexRow);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <Pressable
        style={styles.cardTop}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${deal.title}`}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.cardTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {headline}
          </Text>
          {subtitle ? (
            <Text
              style={{ fontSize: 12.5, color: colors.textMuted }}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Text
          style={{
            fontSize: 15,
            fontFamily: f.extrabold,
            color: colors.primary,
          }}
        >
          {formatInr(deal.value)}
        </Text>
        <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
      </Pressable>

      {contactName ? (
        <Link href={`/(app)/contact/${deal.contact_id}`} asChild>
          <Pressable style={styles.linkRow}>
            <Avatar name={contactName} size={22} />
            <Text
              style={{ fontSize: 13.5, color: colors.textMuted }}
              numberOfLines={1}
            >
              {contactName}
            </Text>
          </Pressable>
        </Link>
      ) : null}

      {brokeragePaid ? (
        <View style={styles.receiptRow}>
          <Ionicons name="checkmark-circle" size={15} color={colors.success} />
          <Text style={{ fontSize: 12.5, color: colors.success }}>
            Brokerage received · {formatInr(dealBrokerage(deal))}
            {deal.brokerage_paid_at
              ? ` · ${new Date(deal.brokerage_paid_at).toLocaleDateString([], {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}`
              : ''}
          </Text>
        </View>
      ) : null}
      {deal.property ? (
        <Link href={`/(app)/property/${deal.property_id}`} asChild>
          <Pressable style={styles.linkRow}>
            <Ionicons name="home-outline" size={15} color={colors.textMuted} />
            <Text
              style={{ fontSize: 13.5, color: colors.textMuted }}
              numberOfLines={1}
            >
              {deal.property.title}
            </Text>
          </Pressable>
        </Link>
      ) : null}

      <View style={styles.cardBottom}>
        {deal.status !== 'open' ? (
          <Text
            style={{
              fontSize: 12,
              fontFamily: f.bold,
              color: deal.status === 'won' ? colors.success : colors.danger,
              textTransform: 'uppercase',
            }}
          >
            {deal.status}
          </Text>
        ) : (
          <View />
        )}
        <Pressable
          onPress={() => router.push(`/deal/${deal.id}`)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Open the deal folder for ${deal.title}`}
          style={[styles.moveButton, { backgroundColor: colors.primarySoft }]}
        >
          <Ionicons
            name="folder-open-outline"
            size={14}
            color={colors.primary}
          />
          <Text
            style={{
              fontSize: 12.5,
              fontFamily: f.bold,
              color: colors.primary,
            }}
          >
            Folder
          </Text>
        </Pressable>
        <Pressable
          onPress={brokeragePaid ? onReopen : onMove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            brokeragePaid
              ? `Reopen ${deal.title}`
              : `Move ${deal.title} to another stage`
          }
          style={[styles.moveButton, { backgroundColor: colors.primarySoft }]}
        >
          <Ionicons
            name={brokeragePaid ? 'refresh' : 'swap-horizontal'}
            size={14}
            color={colors.primary}
          />
          <Text
            style={{
              fontSize: 12.5,
              fontFamily: f.bold,
              color: colors.primary,
            }}
          >
            {brokeragePaid ? 'Reopen' : 'Move stage'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  outcomeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  filtersRow: { height: 52, justifyContent: 'center' },
  filters: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  stageSummary: {
    fontSize: 12.5,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  card: {
    borderWidth: 1,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 8,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 15.5, fontFamily: fonts.bold },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  receiptRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  moveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  modalTitle: { flex: 1, fontSize: 15.5, fontFamily: fonts.bold },
  brokerageForm: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
