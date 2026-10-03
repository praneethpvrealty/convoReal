import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, Stack, router } from 'expo-router';
import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { Confetti, EnterRow } from '@/components/motion';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { LostReasonSheet } from '@/components/lost-reason-sheet';
import { StageWheel } from '@/components/stage-wheel';
import {
  Avatar,
  ConversationSkeleton,
  EmptyState,
  FilterChip,
  PrimaryButton,
  TextField,
} from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { useBoardLayout } from '@/lib/board-layout-preference';
import { contactFullName } from '@/lib/contact-name';
import {
  BOARD_FOCUS_QUERY_KEY,
  BOARD_SCOPES,
  boardDeals,
  DEAL_SAVED_QUERY_KEYS,
  expectedCloseLabel,
  isClosingRecord,
  RECORDS_SORTS,
  sortIndexRows,
  transactionSubtitle,
  transactionTitle,
  type BoardScope,
  type RecordsSort,
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
  isLostStage,
  needsBrokerageCapture,
  pipelineOutcomeForStage,
  type PipelineOutcome,
} from '@/lib/stage-semantics';
import {
  lostReasonLabel,
  recordedLostReason,
  type LostReasonInput,
} from '@/lib/lost-reasons';
import { initialWheelStageIndex } from '@/lib/stage-wheel';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme, fonts } from '@/lib/theme';
import type { Deal, Pipeline, PipelineStage } from '@/lib/types';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { DEALS_VIEWS } from '@shared/lib/deals/routes';
import { BOARD_LAYOUTS } from '@shared/lib/pipelines/board-layout';
import {
  dealCardCopy,
  dealFee,
  dealFeeLabel,
  stageTotals,
  stageTotalsLabel,
} from '@shared/lib/pipelines/deal-money';

import { JourneyBody } from './journey';

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

const OUTCOME_ORDER: readonly PipelineOutcome[] = [
  'active',
  'successful',
  'lost',
];

function flatStageOrder(stages: readonly PipelineStage[]): PipelineStage[] {
  const byPosition = [...stages].sort((a, b) => a.position - b.position);
  return OUTCOME_ORDER.flatMap((outcome) =>
    byPosition.filter((stage) => pipelineOutcomeForStage(stage) === outcome)
  );
}

interface FlatSection {
  stage: PipelineStage;
  marker: string | null;
  data: Deal[];
}

export default function DealsScreen() {
  const { colors, fonts: f } = useTheme();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [outcomeView, setOutcomeView] = useState<PipelineOutcome>('active');
  const [boardScope, setBoardScope] = useState<BoardScope>('focus');
  const [boardLayout, setBoardLayout] = useBoardLayout();
  const flat = boardLayout === 'flat';
  const [movingDeal, setMovingDeal] = useState<Deal | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [lostPrompt, setLostPrompt] = useState<{
    deal: Deal;
    stage: PipelineStage;
  } | null>(null);
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
  const focusQuery = useQuery({
    queryKey: [BOARD_FOCUS_QUERY_KEY, accountId, activePipeline],
    enabled: Boolean(accountId && activePipeline),
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.rpc('board_focus_deal_ids', {
        target_account_id: accountId!,
        target_pipeline_id: activePipeline!,
      });
      if (error) throw error;
      return (data ?? []) as string[];
    },
  });
  const focusDeals = useMemo(
    () => boardDeals(deals ?? [], 'focus', focusQuery.data),
    [deals, focusQuery.data]
  );
  const boardList = useMemo(
    () => (boardScope === 'focus' ? focusDeals : (deals ?? [])),
    [boardScope, focusDeals, deals]
  );
  const pull = usePullRefresh(() =>
    Promise.all([refetch(), focusQuery.refetch()])
  );
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
    for (const deal of boardList) {
      const stage = stageById.get(deal.stage_id);
      if (stage) counts[pipelineOutcomeForStage(stage)] += 1;
    }
    return counts;
  }, [boardList, stageById]);

  const visibleStages = useMemo(
    () =>
      flat
        ? flatStageOrder(stages ?? [])
        : (stages ?? []).filter(
            (stage) => pipelineOutcomeForStage(stage) === outcomeView
          ),
    [stages, outcomeView, flat]
  );
  const firstClosedIndex = useMemo(
    () => ({
      successful: visibleStages.findIndex(
        (stage) => pipelineOutcomeForStage(stage) === 'successful'
      ),
      lost: visibleStages.findIndex(
        (stage) => pipelineOutcomeForStage(stage) === 'lost'
      ),
    }),
    [visibleStages]
  );
  const flatSections = useMemo<FlatSection[]>(
    () =>
      flat
        ? visibleStages.map((stage, index) => ({
            stage,
            marker:
              index === firstClosedIndex.successful
                ? 'Closed won'
                : index === firstClosedIndex.lost
                  ? 'Lost'
                  : null,
            data: boardList.filter((d) => d.stage_id === stage.id),
          }))
        : [],
    [flat, visibleStages, firstClosedIndex, boardList]
  );
  const sectionListRef = useRef<SectionList<Deal, FlatSection>>(null);
  const jumpRef = useRef<{ sectionIndex: number; retries: number } | null>(
    null
  );
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (jumpRef.current) return;
      const top = viewableItems.find((token) => token.section)?.section as
        FlatSection | undefined;
      if (top) setStageId(top.stage.id);
    },
    []
  );

  function scrollToSection(sectionIndex: number) {
    sectionListRef.current?.scrollToLocation({
      sectionIndex,
      itemIndex: 0,
      viewOffset: 0,
      animated: true,
    });
  }

  function jumpToStage(index: number) {
    const stage = visibleStages[index];
    if (!stage) return;
    jumpRef.current = { sectionIndex: index, retries: 0 };
    setStageId(stage.id);
    scrollToSection(index);
  }
  const visibleStageCounts = useMemo(
    () =>
      visibleStages.map(
        (stage) => boardList.filter((d) => d.stage_id === stage.id).length
      ),
    [visibleStages, boardList]
  );
  const openingKey = `${activePipeline}:${flat ? 'flat' : outcomeView}`;
  const [openingStage, setOpeningStage] = useState<{
    key: string;
    id: string;
  } | null>(null);
  if (deals && visibleStages.length > 0 && openingStage?.key !== openingKey) {
    setOpeningStage({
      key: openingKey,
      id: visibleStages[initialWheelStageIndex(visibleStageCounts)].id,
    });
  }
  const openedStageId =
    openingStage?.key === openingKey ? openingStage.id : null;
  const activeStage =
    visibleStages.find((stage) => stage.id === stageId)?.id ??
    visibleStages.find((stage) => stage.id === openedStageId)?.id ??
    visibleStages[0]?.id ??
    null;
  const stageDeals = useMemo(
    () => boardList.filter((d) => d.stage_id === activeStage),
    [boardList, activeStage]
  );
  const selectedStage = (stages ?? []).find(
    (stage) => stage.id === activeStage
  );

  function chooseLayout(next: typeof boardLayout) {
    if (next === boardLayout) return;
    if (next === 'wheel' && selectedStage) {
      setOutcomeView(pipelineOutcomeForStage(selectedStage));
      setStageId(selectedStage.id);
    }
    setBoardLayout(next);
  }

  async function moveDeal(
    deal: Deal,
    stage: PipelineStage,
    brokerage?: {
      brokerage_type: 'percentage' | 'fixed';
      brokerage_value: number;
    },
    lost?: LostReasonInput
  ) {
    setMovingDeal(null);
    setBrokeragePrompt(null);
    setLostPrompt(null);
    if (!lost && isLostStage(stage)) {
      const recorded = recordedLostReason(deal);
      if (!recorded) {
        setLostPrompt({ deal, stage });
        return;
      }
      lost = recorded;
    }
    if (
      !brokerage &&
      needsBrokerageCapture(
        { brokerage_amount: deal.brokerage_amount ?? null },
        stage
      )
    ) {
      setBrokerageType('percentage');
      setBrokerageValue('');
      setBrokeragePrompt({ deal, stage });
      return;
    }
    if (isBrokeragePaidStage(stage)) {
      haptic.success();
      setCelebrating(true);
    } else {
      haptic.tap();
    }
    try {
      await moveDealStage(deal.id, {
        status: dealStatusForStage(stage),
        target_stage_id: stage.id,
        property_id: deal.property_id ?? null,
        current_stage_name: stage.name,
        ...brokerage,
        ...lost,
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
    if (!flat) {
      setOutcomeView(pipelineOutcomeForStage(stage));
      setStageId(stage.id);
    }
    await Promise.all(
      DEAL_SAVED_QUERY_KEYS.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey })
      )
    );
  }

  async function reopenDeal(deal: Deal) {
    const orderedStages = [...(stages ?? [])].sort(
      (a, b) => a.position - b.position
    );
    const target =
      orderedStages.find((stage) => isBrokeragePendingStage(stage)) ??
      [...orderedStages]
        .reverse()
        .find(
          (stage) =>
            pipelineOutcomeForStage(stage) === 'successful' &&
            !isBrokeragePaidStage(stage)
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
        {DEALS_VIEWS.map((view) => (
          <FilterChip
            key={view.id}
            label={view.label}
            active={segment === view.id}
            onPress={() => {
              setSegment(view.id);
              if (view.id === 'board') void focusQuery.refetch();
            }}
          />
        ))}
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
        <View style={[styles.outcomeRow, styles.wrapRow]}>
          <View
            style={styles.chipGroup}
            accessibilityLabel="Deals shown on the board"
          >
            {BOARD_SCOPES.map((scope) => (
              <FilterChip
                key={scope.id}
                label={`${scope.label} (${
                  scope.id === 'all' ? (deals?.length ?? 0) : focusDeals.length
                })`}
                active={boardScope === scope.id}
                onPress={() => {
                  setBoardScope(scope.id);
                  setStageId(null);
                }}
              />
            ))}
          </View>
          <View
            style={[styles.chipGroup, styles.layoutToggle]}
            accessibilityLabel="Board layout"
          >
            {BOARD_LAYOUTS.map((option) => (
              <FilterChip
                key={option.id}
                label={option.label}
                accessibilityLabel={option.hint}
                active={boardLayout === option.id}
                onPress={() => chooseLayout(option.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {segment === 'board' && !flat ? (
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

      {segment === 'board' && flat && visibleStages.length > 0 ? (
        <View style={styles.header}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityLabel="Pipeline stages"
          >
            <View style={styles.stageStrip}>
              {visibleStages.map((stage, index) => {
                const marker = flatSections[index]?.marker ?? null;
                return (
                  <Fragment key={stage.id}>
                    {marker ? (
                      <Text
                        style={[
                          styles.stageDivider,
                          {
                            color: colors.textFaint,
                            borderLeftColor: colors.border,
                          },
                        ]}
                      >
                        {marker}
                      </Text>
                    ) : null}
                    <FilterChip
                      label={`${stage.name} (${visibleStageCounts[index]})`}
                      active={stage.id === activeStage}
                      onPress={() => jumpToStage(index)}
                    />
                  </Fragment>
                );
              })}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {segment === 'board' && !flat && visibleStages.length > 0 ? (
        <StageWheel
          stages={visibleStages.map((s, index) => ({
            id: s.id,
            name: s.name,
            color: s.color ?? colors.primary,
            count: visibleStageCounts[index],
          }))}
          activeId={activeStage}
          onSelect={setStageId}
        />
      ) : null}

      {segment === 'board' && !flat && stageDeals.length > 0 ? (
        <Text style={[styles.stageSummary, { color: colors.textMuted }]}>
          {stageDeals.length} deal{stageDeals.length === 1 ? '' : 's'} ·{' '}
          {stageTotalsLabel(stageTotals(stageDeals), {
            paid: selectedStage ? isBrokeragePaidStage(selectedStage) : false,
          })}
        </Text>
      ) : null}

      {segment !== 'board' ? null : isLoading ||
        (boardScope === 'focus' && focusQuery.isLoading) ? (
        <View>
          {Array.from({ length: 5 }, (_, i) => (
            <ConversationSkeleton key={i} />
          ))}
        </View>
      ) : boardScope === 'focus' && focusQuery.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load Focus"
          subtitle="The board could not tell which journeys are in Focus."
          action={
            <PrimaryButton
              label="Show all deals"
              onPress={() => setBoardScope('all')}
            />
          }
        />
      ) : !pipelines?.length ? (
        <EmptyState
          icon="trending-up-outline"
          title="No pipeline yet"
          subtitle="Create your first sales pipeline on the web app — deals will show up here."
        />
      ) : flat ? (
        <SectionList<Deal, FlatSection>
          ref={sectionListRef}
          style={{ flex: 1 }}
          sections={flatSections}
          keyExtractor={(d) => d.id}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={colors.primary}
            />
          }
          onViewableItemsChanged={onViewableItemsChanged}
          onScrollBeginDrag={() => {
            jumpRef.current = null;
          }}
          onScrollToIndexFailed={(info) => {
            const jump = jumpRef.current;
            if (!jump || jump.retries >= 3) return;
            jump.retries += 1;
            sectionListRef.current?.getScrollResponder()?.scrollTo({
              y: info.averageItemLength * info.index,
              animated: false,
            });
            setTimeout(() => {
              if (jumpRef.current === jump) scrollToSection(jump.sectionIndex);
            }, 120);
          }}
          ListEmptyComponent={
            <EmptyState
              icon="file-tray-outline"
              title="No stages in this pipeline"
              subtitle="Add stages to the pipeline and its deals will show up here."
            />
          }
          renderSectionHeader={({ section }) => {
            const totals = stageTotalsLabel(stageTotals(section.data), {
              paid: isBrokeragePaidStage(section.stage),
            });
            return (
              <View
                style={[
                  styles.sectionHeader,
                  { backgroundColor: colors.background },
                ]}
              >
                {section.marker ? (
                  <Text
                    style={[
                      styles.sectionDivider,
                      {
                        color: colors.textFaint,
                        borderTopColor: colors.border,
                      },
                    ]}
                  >
                    {section.marker}
                  </Text>
                ) : null}
                <View
                  style={styles.sectionTitleRow}
                  accessibilityRole="header"
                  accessibilityLabel={`${section.stage.name}, ${section.data.length} deal${section.data.length === 1 ? '' : 's'}, ${totals}`}
                >
                  <View
                    style={[
                      styles.stageDot,
                      {
                        backgroundColor: section.stage.color || colors.primary,
                      },
                    ]}
                  />
                  <Text
                    style={[styles.sectionTitle, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {section.stage.name}
                  </Text>
                  <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                    {section.data.length}
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 12.5,
                    color:
                      section.data.length === 0
                        ? colors.textFaint
                        : colors.textMuted,
                  }}
                >
                  {totals}
                </Text>
              </View>
            );
          }}
          renderItem={({ item, index, section }) => (
            <EnterRow index={index}>
              <DealCard
                deal={item}
                stage={section.stage}
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

      <LostReasonSheet
        dealTitle={lostPrompt?.deal.title ?? null}
        onClose={() => setLostPrompt(null)}
        onConfirm={(lost) =>
          lostPrompt &&
          void moveDeal(lostPrompt.deal, lostPrompt.stage, undefined, lost)
        }
      />

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

function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  const [sort, setSort] = useState<RecordsSort>('updated');
  const today = localDayKey();
  const sorted = useMemo(() => sortIndexRows(rows, sort), [rows, sort]);
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
      data={sorted}
      keyExtractor={(r) => r.id}
      ListHeaderComponent={
        <View
          style={{
            flexDirection: 'row',
            gap: spacing.sm,
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.sm,
          }}
        >
          {RECORDS_SORTS.map((option) => (
            <FilterChip
              key={option.id}
              label={option.label}
              active={sort === option.id}
              onPress={() => setSort(option.id)}
            />
          ))}
        </View>
      }
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
        const close = expectedCloseLabel(item, today);
        return (
          <EnterRow index={index}>
            <Pressable
              onPress={() => router.push(`/deal/${item.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open the closing record for ${transactionTitle(item)}`}
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
              {close ? (
                <Text
                  style={{
                    fontSize: 12,
                    color:
                      close.tone === 'overdue'
                        ? colors.danger
                        : close.tone === 'soon'
                          ? colors.warning
                          : close.tone === 'done'
                            ? colors.success
                            : colors.textMuted,
                  }}
                >
                  {close.text}
                </Text>
              ) : null}
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
  const fullName = deal.contact ? contactFullName(deal.contact) : '';
  const contactName = fullName || deal.contact?.phone;
  const brokeragePaid = stage ? isBrokeragePaidStage(stage) : false;
  const { headline, subline } = dealCardCopy({
    title: deal.title,
    contact: { name: fullName || null },
    property: deal.property ?? null,
  });

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
            numberOfLines={2}
          >
            {headline}
          </Text>
          {subline ? (
            <Text
              style={{ fontSize: 12.5, color: colors.textMuted }}
              numberOfLines={1}
            >
              {subline}
            </Text>
          ) : null}
          {brokeragePaid ? null : (
            <Text
              style={{
                fontSize: 12.5,
                color:
                  dealFee(deal) === null ? colors.textFaint : colors.textMuted,
              }}
            >
              {dealFeeLabel(deal)}
            </Text>
          )}
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

      {deal.status === 'lost' && lostReasonLabel(deal) ? (
        <View style={styles.receiptRow}>
          <Ionicons name="close-circle" size={15} color={colors.danger} />
          <Text
            style={{ flex: 1, fontSize: 12.5, color: colors.danger }}
            numberOfLines={2}
          >
            {lostReasonLabel(deal)}
          </Text>
        </View>
      ) : null}

      {brokeragePaid ? (
        <View style={styles.receiptRow}>
          <Ionicons name="checkmark-circle" size={15} color={colors.success} />
          <Text style={{ fontSize: 12.5, color: colors.success }}>
            {dealFeeLabel(deal, { paid: true })}
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
  wrapRow: { flexWrap: 'wrap', rowGap: spacing.sm },
  chipGroup: { flexDirection: 'row', gap: spacing.sm },
  layoutToggle: { marginLeft: 'auto' },
  stageStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  stageDivider: {
    fontSize: 11,
    fontFamily: fonts.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    borderLeftWidth: 1,
    paddingLeft: spacing.sm,
    marginLeft: spacing.xs,
  },
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: 2,
  },
  sectionDivider: {
    fontSize: 11,
    fontFamily: fonts.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stageDot: { width: 10, height: 10, borderRadius: 5 },
  sectionTitle: { flexShrink: 1, fontSize: 14.5, fontFamily: fonts.bold },
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
