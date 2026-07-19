import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/app/(app)/(tabs)/_layout';
import { Confetti, EnterRow } from '@/components/motion';
import { BottomSheet } from '@/components/sheet';
import { Avatar, ConversationSkeleton, EmptyState, FilterChip } from '@/components/ui';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme , fonts } from '@/lib/theme';
import type { Deal, Pipeline, PipelineStage } from '@/lib/types';

/** Same status derivation the web kanban applies on stage move. */
function statusForStage(stageName: string): Deal['status'] {
  const n = stageName.toLowerCase();
  if (n.includes('lost')) return 'lost';
  if (n.includes('won')) return 'won';
  return 'open';
}

/** Web parity: moving a deal also nudges the linked property's status. */
function propertyStatusForStage(stageName: string): string | null {
  const n = stageName.toLowerCase();
  if (n.includes('lost')) return 'Available';
  if (n.includes('won') || n.includes('closed')) return 'Sold';
  if (n.includes('negotiation') || n.includes('token')) return 'Under Contract';
  return null;
}

export default function DealsScreen() {
  const { colors, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [movingDeal, setMovingDeal] = useState<Deal | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pipelines').select('id, name').order('created_at');
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

  const { data: deals, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['deals', activePipeline],
    enabled: Boolean(activePipeline),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deals')
        .select('*, contact:contacts(id, name, phone), property:properties(id, title)')
        .eq('pipeline_id', activePipeline!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Deal[];
    },
  });

  const activeStage = stageId ?? stages?.[0]?.id ?? null;
  const stageDeals = useMemo(
    () => (deals ?? []).filter((d) => d.stage_id === activeStage),
    [deals, activeStage]
  );
  const stageValue = stageDeals.reduce((sum, d) => sum + (d.value ?? 0), 0);

  async function moveDeal(deal: Deal, stage: PipelineStage) {
    setMovingDeal(null);
    const status = statusForStage(stage.name);
    if (status === 'won') {
      haptic.success();
      setCelebrating(true);
    } else {
      haptic.tap();
    }
    const { error } = await supabase
      .from('deals')
      .update({ stage_id: stage.id, status })
      .eq('id', deal.id);
    if (!error && deal.property_id) {
      const propertyStatus = propertyStatusForStage(stage.name);
      if (propertyStatus) {
        await supabase
          .from('properties')
          .update({ status: propertyStatus })
          .eq('id', deal.property_id);
      }
    }
    queryClient.invalidateQueries({ queryKey: ['deals', activePipeline] });
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={[styles.title, { color: colors.text, fontFamily: f.extrabold }]}>Deals</Text>
        {pipelines && pipelines.length > 1 ? (
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
                  }}
                />
              ))}
            </View>
          </ScrollView>
        ) : null}
      </View>

      {/* Stage strip — the mobile take on kanban columns. */}
      <View style={styles.filtersRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {(stages ?? []).map((s) => {
            const count = (deals ?? []).filter((d) => d.stage_id === s.id).length;
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

      {stageDeals.length > 0 ? (
        <Text style={[styles.stageSummary, { color: colors.textMuted }]}>
          {stageDeals.length} deal{stageDeals.length === 1 ? '' : 's'} · {formatInr(stageValue)}
        </Text>
      ) : null}

      {isLoading ? (
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
          contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE }}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
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
              <DealCard deal={item} onMove={() => setMovingDeal(item)} />
            </EnterRow>
          )}
        />
      )}

      {celebrating ? <Confetti onDone={() => setCelebrating(false)} /> : null}

      {/* Stage picker for the deal being moved. */}
      <BottomSheet visible={Boolean(movingDeal)} onClose={() => setMovingDeal(null)}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
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
                  <Text style={{ fontSize: 15, fontFamily: f.semibold, color: colors.text }}>
                    {s.name}
                  </Text>
                </Pressable>
              ))}
      </BottomSheet>
    </View>
  );
}

function DealCard({ deal, onMove }: { deal: Deal; onMove: () => void }) {
  const { colors, fonts: f } = useTheme();
  const contactName = deal.contact?.name || deal.contact?.phone;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
          {deal.title}
        </Text>
        <Text style={{ fontSize: 15, fontFamily: f.extrabold, color: colors.primary }}>
          {formatInr(deal.value)}
        </Text>
      </View>

      {contactName ? (
        <Link href={`/(app)/contact/${deal.contact_id}`} asChild>
          <Pressable style={styles.linkRow}>
            <Avatar name={contactName} size={22} />
            <Text style={{ fontSize: 13.5, color: colors.textMuted }} numberOfLines={1}>
              {contactName}
            </Text>
          </Pressable>
        </Link>
      ) : null}
      {deal.property ? (
        <Link href={`/(app)/property/${deal.property_id}`} asChild>
          <Pressable style={styles.linkRow}>
            <Ionicons name="home-outline" size={15} color={colors.textMuted} />
            <Text style={{ fontSize: 13.5, color: colors.textMuted }} numberOfLines={1}>
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
          onPress={onMove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Move ${deal.title} to another stage`}
          style={[styles.moveButton, { backgroundColor: colors.primarySoft }]}
        >
          <Ionicons name="swap-horizontal" size={14} color={colors.primary} />
          <Text style={{ fontSize: 12.5, fontFamily: f.bold, color: colors.primary }}>
            Move stage
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, gap: spacing.md },
  title: { fontSize: 30, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  filtersRow: { height: 52, justifyContent: 'center' },
  filters: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: 'center' },
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
  cardTitle: { flex: 1, fontSize: 15.5, fontFamily: fonts.bold },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
