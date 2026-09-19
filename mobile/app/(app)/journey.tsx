import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import {
  Avatar,
  EmptyState,
  FilterChip,
  PrimaryButton,
  TextField,
} from '@/components/ui';
import {
  ApiError,
  addJourneyStageNote,
  loadJourneyOverview,
  logPersonalWhatsAppJourneySend,
  updateJourneyOverview,
} from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { buildCheckInMessage } from '@/lib/checkin-message';
import {
  convertJourneyItemToDeal,
  moveJourneyItem,
} from '@/lib/deal-workspace-api';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import {
  CLOSED_JOURNEY_STATUS_LABELS,
  JOURNEY_CLOSURE_REASONS,
  type ClosedJourneyStatus,
  type JourneyLifecycleStatus,
} from '@/lib/journey-overview';
import { openContactChat } from '@/lib/open-chat';
import { contactPropertyShareUrl } from '@/lib/showcase-share';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type {
  JourneyItem,
  JourneyOverviewGroup,
  JourneyOverviewState,
  JourneyStage,
  JourneyStageNote,
} from '@/lib/types';
import { usePullRefresh } from '@/lib/use-pull-refresh';

type JourneyView = 'active' | 'closed' | 'archived';
type JourneyMode = 'buyer' | 'property';
const JOURNEY_BRANCH_PAGE_SIZE = 1000;
const JOURNEY_NOTE_PAGE_SIZE = 500;

interface JourneyGroup {
  subjectId: string;
  contact: JourneyItem['contact'];
  property: JourneyItem['property'];
  captured: number;
  furthestStageIdx: number;
  lifecycleStatus: JourneyLifecycleStatus;
  closureReason: string | null;
  archivedAt: string | null;
  sortOrder: number;
}

interface JourneyBucket {
  key: string;
  label: string;
  color: string;
  groups: JourneyGroup[];
}

export default function JourneyScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Journeys' }} />
      <JourneyBody />
    </>
  );
}

export function JourneyBody() {
  const { colors, fonts: f } = useTheme();
  const queryClient = useQueryClient();
  const profile = useAuthStore((state) => state.profile);
  const accountId = profile?.account_id;
  const canEdit = Boolean(profile && profile.account_role !== 'viewer');
  const { show, close, dialogProps } = useAppDialog();
  const [convertingItemId, setConvertingItemId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<JourneyItem | null>(null);
  const [brokeragePrompt, setBrokeragePrompt] = useState<{
    item: JourneyItem;
    stage: JourneyStage;
    dealValue: number;
  } | null>(null);
  const [brokerageType, setBrokerageType] = useState<'percentage' | 'fixed'>(
    'percentage'
  );
  const [brokerageValue, setBrokerageValue] = useState('');

  // The same move the web journey makes: a mirrored stage moves the
  // item's deal through the board's logic, and the route pauses for
  // the brokerage exactly as the board does.
  async function moveItem(
    item: JourneyItem,
    stage: JourneyStage,
    brokerage?: {
      brokerage_type: 'percentage' | 'fixed';
      brokerage_value: number;
    }
  ) {
    setMoveTarget(null);
    setBrokeragePrompt(null);
    try {
      await moveJourneyItem(item.id, stage.id, brokerage);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.code === 'BROKERAGE_REQUIRED'
      ) {
        const data = err.data as { deal_value?: number } | null;
        setBrokerageType('percentage');
        setBrokerageValue('');
        setBrokeragePrompt({
          item,
          stage,
          dealValue: Number(data?.deal_value ?? 0) || 0,
        });
        return;
      }
      void haptic.warn();
      show({
        title: 'Could not move',
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    void haptic.success();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['journey-branch-items'] }),
      queryClient.invalidateQueries({ queryKey: ['journey-overview-groups'] }),
      queryClient.invalidateQueries({ queryKey: ['transaction-index'] }),
    ]);
  }

  function askConvert(item: JourneyItem) {
    if (!canEdit || convertingItemId) return;
    show({
      title: 'Convert to deal?',
      message:
        'Opens the closing record — milestones, papers, tasks and money — and keeps this journey and its history as they are.',
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: 'Convert',
          onPress: async () => {
            close();
            setConvertingItemId(item.id);
            try {
              const result = await convertJourneyItemToDeal(item.id);
              void haptic.success();
              router.push(`/deal/${result.id}`);
            } catch (err) {
              show({
                title: 'Could not convert',
                message: err instanceof Error ? err.message : String(err),
              });
            } finally {
              setConvertingItemId(null);
            }
          },
        },
      ],
    });
  }

  const { contactId, propertyId } = useLocalSearchParams<{
    contactId?: string;
    propertyId?: string;
  }>();
  const [mode, setMode] = useState<JourneyMode>(() =>
    propertyId ? 'property' : 'buyer'
  );
  const [view, setView] = useState<JourneyView>('active');
  const [query, setQuery] = useState('');
  const [closedBuckets, setClosedBuckets] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [orderOverrides, setOrderOverrides] = useState<Map<string, number>>(
    new Map()
  );
  const [noteTarget, setNoteTarget] = useState<{
    item: JourneyItem;
    stage: JourneyStage;
  } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const stagesQuery = useQuery({
    queryKey: ['journey-stages', accountId],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const synced = await supabase.rpc('sync_journey_stages_from_pipeline', {
        p_account_id: accountId!,
        p_pipeline_id: null,
      });
      if (!synced.error && Array.isArray(synced.data) && synced.data.length) {
        return synced.data as JourneyStage[];
      }
      const { data, error } = await supabase
        .from('journey_stages')
        .select('id, name, color, position, pipeline_stage_id')
        .not('pipeline_stage_id', 'is', null)
        .order('position');
      if (error) throw error;
      return (data ?? []) as JourneyStage[];
    },
  });

  const summariesQuery = useQuery({
    queryKey: ['journey-overview-groups', accountId, mode],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('journey_overview_groups', {
        p_account_id: accountId!,
        p_mode: mode,
      });
      if (error) throw error;
      return (data ?? []) as JourneyOverviewGroup[];
    },
  });

  const statesQuery = useQuery({
    queryKey: ['journey-overview-states', mode],
    enabled: Boolean(accountId),
    queryFn: async () =>
      (await loadJourneyOverview(mode)).data as JourneyOverviewState[],
  });

  const notesQuery = useQuery({
    queryKey: ['journey-stage-notes', noteTarget?.item.id],
    enabled: Boolean(noteTarget),
    queryFn: () => loadJourneyStageNotes(noteTarget!.item.id),
  });

  const pull = usePullRefresh(async () => {
    await Promise.all([
      stagesQuery.refetch(),
      summariesQuery.refetch(),
      statesQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['journey-branch-items'] }),
    ]);
  });

  const stages = useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);
  const notesByStage = useMemo(() => {
    const grouped = new Map<string, JourneyStageNote[]>();
    for (const note of notesQuery.data ?? []) {
      if (!note.stage_id) continue;
      const notes = grouped.get(note.stage_id) ?? [];
      notes.push(note);
      grouped.set(note.stage_id, notes);
    }
    return grouped;
  }, [notesQuery.data]);
  const stageById = useMemo(
    () => new Map(stages.map((stage) => [stage.id, stage])),
    [stages]
  );
  const stageIndexById = useMemo(
    () => new Map(stages.map((stage, index) => [stage.id, index])),
    [stages]
  );
  const stateBySubject = useMemo(
    () =>
      new Map(
        (statesQuery.data ?? []).map((state) => [state.subject_id, state])
      ),
    [statesQuery.data]
  );

  const groups = useMemo(() => {
    return (summariesQuery.data ?? [])
      .filter((row) => {
        if (mode === 'buyer' && contactId) return row.subject_id === contactId;
        if (mode === 'property' && propertyId)
          return row.subject_id === propertyId;
        return true;
      })
      .map((row): JourneyGroup => {
        const state = stateBySubject.get(row.subject_id);
        return {
          subjectId: row.subject_id,
          contact:
            mode === 'buyer'
              ? ({
                  id: row.subject_id,
                  name: row.contact_name,
                  phone: row.contact_phone,
                } as JourneyItem['contact'])
              : null,
          property:
            mode === 'property'
              ? {
                  id: row.subject_id,
                  title: row.property_title || 'Unknown property',
                  property_code: row.property_code,
                  location: row.property_location,
                }
              : null,
          captured: Number(row.captured_count),
          furthestStageIdx: stageIndexById.get(row.furthest_stage_id) ?? -1,
          lifecycleStatus: state?.lifecycle_status ?? 'active',
          closureReason: state?.closure_reason ?? null,
          archivedAt: state?.archived_at ?? null,
          sortOrder:
            orderOverrides.get(row.subject_id) ??
            state?.sort_order ??
            Number.MAX_SAFE_INTEGER,
        };
      })
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          right.furthestStageIdx - left.furthestStageIdx
      );
  }, [
    contactId,
    mode,
    orderOverrides,
    propertyId,
    stageIndexById,
    stateBySubject,
    summariesQuery.data,
  ]);

  const searchedGroups = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const digits = term.replace(/\D/g, '');
    return groups.filter((group) => {
      if (!term) return true;
      const values =
        mode === 'buyer'
          ? [group.contact?.name, group.contact?.phone]
          : [
              group.property?.title,
              group.property?.property_code,
              group.property?.location,
            ];
      const haystack = values.filter(Boolean).join(' ').toLocaleLowerCase();
      return (
        haystack.includes(term) ||
        Boolean(digits && haystack.replace(/\D/g, '').includes(digits))
      );
    });
  }, [groups, mode, query]);

  const viewGroups = useMemo(
    () =>
      searchedGroups.filter((group) => {
        if (view === 'archived') return Boolean(group.archivedAt);
        if (group.archivedAt) return false;
        return view === 'closed'
          ? group.lifecycleStatus !== 'active'
          : group.lifecycleStatus === 'active';
      }),
    [searchedGroups, view]
  );

  const counts = useMemo(
    () => ({
      active: groups.filter(
        (group) => !group.archivedAt && group.lifecycleStatus === 'active'
      ).length,
      closed: groups.filter(
        (group) => !group.archivedAt && group.lifecycleStatus !== 'active'
      ).length,
      archived: groups.filter((group) => Boolean(group.archivedAt)).length,
    }),
    [groups]
  );

  const buckets = useMemo<JourneyBucket[]>(() => {
    if (view === 'active') {
      return stages
        .map((stage, index) => ({
          key: `stage:${stage.id}`,
          label: stage.name,
          color: stage.color ?? colors.primary,
          groups: viewGroups.filter(
            (group) => group.furthestStageIdx === index
          ),
        }))
        .filter((bucket) => bucket.groups.length > 0);
    }
    if (view === 'closed') {
      return (
        ['completed', 'paused', 'not_proceeding'] as ClosedJourneyStatus[]
      )
        .map((status) => ({
          key: `closed:${status}`,
          label: CLOSED_JOURNEY_STATUS_LABELS[status],
          color:
            status === 'completed'
              ? colors.success
              : status === 'paused'
                ? colors.warning
                : colors.textFaint,
          groups: viewGroups.filter(
            (group) => group.lifecycleStatus === status
          ),
        }))
        .filter((bucket) => bucket.groups.length > 0);
    }
    return viewGroups.length
      ? [
          {
            key: 'archived',
            label: 'Archived journeys',
            color: colors.textFaint,
            groups: viewGroups,
          },
        ]
      : [];
  }, [
    colors.primary,
    colors.success,
    colors.textFaint,
    colors.warning,
    stages,
    view,
    viewGroups,
  ]);

  async function askCheckIn(item: JourneyItem, stageLabel: string | undefined) {
    const contact = item.contact;
    if (!contact) return;
    haptic.tap();
    const name = contact.name || contact.phone || 'this contact';
    const propertyUrl = item.property
      ? await contactPropertyShareUrl(contact, item.property).catch(() => null)
      : null;
    const message = buildCheckInMessage({
      contactName: contact.name,
      propertyTitle: item.property?.title,
      propertyCode: item.property?.property_code,
      stageName: stageLabel,
      propertyUrl,
    });
    show({
      title: `Check in with ${name}`,
      message,
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: 'ConvoReal',
          onPress: async () => {
            close();
            const outcome = await openContactChat(contact, {
              draftText: message,
            });
            if (!outcome.ok && outcome.error) {
              show({ title: 'Could not open thread', message: outcome.error });
            }
          },
        },
        ...(contact.phone
          ? [
              {
                label: 'WhatsApp',
                variant: 'primary' as const,
                onPress: () => {
                  close();
                  void logPersonalWhatsAppJourneySend({
                    itemId: item.id,
                    message,
                    source: 'mobile',
                  }).catch(() => undefined);
                  Linking.openURL(
                    `https://wa.me/${(contact.phone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
                  );
                },
              },
            ]
          : []),
      ],
    });
  }

  async function mutateGroup(
    group: JourneyGroup,
    action: 'archive' | 'restore' | 'reopen'
  ) {
    close();
    try {
      await updateJourneyOverview({
        action,
        mode,
        subjectId: group.subjectId,
      });
      haptic.success();
      await statesQuery.refetch();
    } catch (error) {
      haptic.warn();
      show({
        title: 'Could not update journey',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }

  function chooseClosure(group: JourneyGroup, status: ClosedJourneyStatus) {
    show({
      title: CLOSED_JOURNEY_STATUS_LABELS[status],
      message:
        'Choose the clearest reason. It remains searchable in Closed journeys.',
      actions: [
        ...JOURNEY_CLOSURE_REASONS[status].map((reason) => ({
          label: reason,
          onPress: () => void closeGroup(group, status, reason),
        })),
        { label: 'Cancel', variant: 'muted', onPress: close },
      ],
    });
  }

  async function closeGroup(
    group: JourneyGroup,
    status: ClosedJourneyStatus,
    reason: string
  ) {
    close();
    try {
      await updateJourneyOverview({
        action: 'close',
        mode,
        subjectId: group.subjectId,
        status,
        reason,
      });
      haptic.success();
      await statesQuery.refetch();
    } catch (error) {
      haptic.warn();
      show({
        title: 'Could not close journey',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }

  function showGroupActions(group: JourneyGroup) {
    if (group.archivedAt) {
      show({
        title: groupTitle(group, mode),
        actions: [
          {
            label: 'Restore from archive',
            variant: 'primary',
            onPress: () => void mutateGroup(group, 'restore'),
          },
          { label: 'Cancel', variant: 'muted', onPress: close },
        ],
      });
      return;
    }
    if (group.lifecycleStatus !== 'active') {
      show({
        title: groupTitle(group, mode),
        message: group.closureReason ?? undefined,
        actions: [
          {
            label: 'Reopen journey',
            variant: 'primary',
            onPress: () => void mutateGroup(group, 'reopen'),
          },
          {
            label: 'Archive',
            onPress: () => void mutateGroup(group, 'archive'),
          },
          { label: 'Cancel', variant: 'muted', onPress: close },
        ],
      });
      return;
    }
    show({
      title: groupTitle(group, mode),
      actions: [
        {
          label: 'Close with outcome',
          variant: 'primary',
          onPress: () =>
            show({
              title: 'How did this journey end?',
              actions: [
                {
                  label: 'Completed successfully',
                  onPress: () => chooseClosure(group, 'completed'),
                },
                {
                  label: 'Paused — may return',
                  onPress: () => chooseClosure(group, 'paused'),
                },
                {
                  label: 'Not proceeding',
                  onPress: () => chooseClosure(group, 'not_proceeding'),
                },
                { label: 'Cancel', variant: 'muted', onPress: close },
              ],
            }),
        },
        {
          label: 'Archive',
          onPress: () => void mutateGroup(group, 'archive'),
        },
        { label: 'Cancel', variant: 'muted', onPress: close },
      ],
    });
  }

  async function moveGroup(bucket: JourneyBucket, from: number, to: number) {
    if (!canEdit || from === to) return;
    const reordered = [...bucket.groups];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setOrderOverrides((current) => {
      const next = new Map(current);
      reordered.forEach((group, index) => next.set(group.subjectId, index));
      return next;
    });
    try {
      await updateJourneyOverview({
        action: 'reorder',
        mode,
        subjectIds: reordered.map((group) => group.subjectId),
      });
      haptic.success();
      await statesQuery.refetch();
    } catch (error) {
      setOrderOverrides(new Map());
      haptic.warn();
      show({
        title: 'Could not save order',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }

  async function saveNote() {
    if (!canEdit || !noteTarget || !noteText.trim() || savingNote) return;
    setSavingNote(true);
    try {
      await addJourneyStageNote({
        itemId: noteTarget.item.id,
        stageId: noteTarget.stage.id,
        note: noteText.trim(),
      });
      haptic.success();
      setNoteText('');
      await notesQuery.refetch();
    } catch (error) {
      haptic.warn();
      show({
        title: 'Could not save note',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setSavingNote(false);
    }
  }

  const isLoading =
    stagesQuery.isLoading || summariesQuery.isLoading || statesQuery.isLoading;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.tabs}>
        {(
          [
            ['buyer', 'Buyer journeys'],
            ['property', 'Property journeys'],
          ] as const
        ).map(([value, label]) => {
          const selected = mode === value;
          return (
            <Pressable
              key={value}
              onPress={() => {
                setMode(value);
                setView('active');
                setQuery('');
                setOrderOverrides(new Map());
                setOpenGroups(new Set());
                setNoteTarget(null);
                setNoteText('');
              }}
              style={[
                styles.tab,
                {
                  backgroundColor: selected ? colors.glass : 'transparent',
                  borderColor: selected ? colors.primary : colors.glassBorder,
                },
              ]}
            >
              <Text
                style={{
                  fontSize: 12.5,
                  fontFamily: f.bold,
                  color: selected ? colors.primary : colors.textMuted,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.tabs}>
        {(
          [
            ['active', 'Active'],
            ['closed', 'Closed'],
            ['archived', 'Archived'],
          ] as const
        ).map(([value, label]) => {
          const selected = view === value;
          return (
            <Pressable
              key={value}
              onPress={() => setView(value)}
              style={[
                styles.tab,
                {
                  backgroundColor: selected ? colors.primary : colors.glass,
                  borderColor: selected ? colors.primary : colors.glassBorder,
                },
              ]}
            >
              <Text
                style={{
                  fontSize: 12.5,
                  fontFamily: f.bold,
                  color: selected ? colors.onPrimary : colors.textMuted,
                }}
              >
                {label} {counts[value]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View
        style={[
          styles.search,
          { backgroundColor: colors.glass, borderColor: colors.glassBorder },
        ]}
      >
        <Ionicons name="search" size={17} color={colors.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={
            mode === 'buyer'
              ? 'Search name or mobile'
              : 'Search property, code or location'
          }
          placeholderTextColor={colors.textFaint}
          style={{ flex: 1, color: colors.text, fontSize: 14 }}
        />
        {query ? (
          <Pressable
            onPress={() => setQuery('')}
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={18} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>

      {!isLoading && buckets.length === 0 ? (
        <EmptyState
          icon="map-outline"
          title={query ? 'No matching journeys' : `No ${view} journeys`}
          subtitle={
            query
              ? mode === 'buyer'
                ? 'Try another name or mobile number.'
                : 'Try another property, code or location.'
              : view === 'active'
                ? 'Journeys are captured when you share properties over WhatsApp.'
                : 'Closed and archived journeys stay available here for later reference.'
          }
        />
      ) : (
        buckets.map((bucket) => {
          const open = query ? true : !closedBuckets.has(bucket.key);
          return (
            <View
              key={bucket.key}
              style={[
                styles.bucket,
                {
                  backgroundColor: colors.glass,
                  borderColor: colors.glassBorder,
                },
              ]}
            >
              <Pressable
                onPress={() =>
                  setClosedBuckets((current) => {
                    const next = new Set(current);
                    if (next.has(bucket.key)) next.delete(bucket.key);
                    else next.add(bucket.key);
                    return next;
                  })
                }
                style={styles.bucketHeader}
              >
                <Ionicons
                  name={open ? 'chevron-down' : 'chevron-forward'}
                  size={17}
                  color={colors.textFaint}
                />
                <View
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 5,
                    backgroundColor: bucket.color,
                  }}
                />
                <Text
                  style={{
                    flex: 1,
                    fontSize: 14,
                    fontFamily: f.bold,
                    color: colors.text,
                  }}
                >
                  {bucket.label}
                </Text>
                <Text style={{ fontSize: 12, color: colors.textMuted }}>
                  {bucket.groups.length}
                </Text>
              </Pressable>
              {open
                ? bucket.groups.map((group, index) => (
                    <DraggableJourneyCard
                      key={group.subjectId}
                      group={group}
                      stage={stages[group.furthestStageIdx]}
                      stageById={stageById}
                      mode={mode}
                      canEdit={canEdit}
                      index={index}
                      count={bucket.groups.length}
                      expanded={openGroups.has(group.subjectId)}
                      onToggle={() =>
                        setOpenGroups((current) => {
                          const next = new Set(current);
                          if (next.has(group.subjectId))
                            next.delete(group.subjectId);
                          else next.add(group.subjectId);
                          return next;
                        })
                      }
                      onMove={(from, to) => void moveGroup(bucket, from, to)}
                      onActions={() => showGroupActions(group)}
                      onCheckIn={askCheckIn}
                      onMoveItem={(item) => canEdit && setMoveTarget(item)}
                      onConvert={askConvert}
                      onAddNote={(item, stage) => {
                        setNoteTarget({ item, stage });
                        setNoteText('');
                      }}
                    />
                  ))
                : null}
            </View>
          );
        })
      )}

      <BottomSheet
        visible={Boolean(noteTarget)}
        onClose={() => {
          setNoteTarget(null);
          setNoteText('');
        }}
        title="Journey stage notes"
      >
        <ScrollView
          style={sheetScrollArea}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        >
          {noteTarget ? (
            <View style={{ gap: spacing.sm }}>
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: f.bold,
                  color: colors.textMuted,
                  textTransform: 'uppercase',
                }}
              >
                Note stage
              </Text>
              <View style={{ gap: spacing.xs }}>
                {stages.map((stage) => {
                  const selected = stage.id === noteTarget.stage.id;
                  const stageColor = stage.color ?? colors.primary;
                  const stageNotes = notesByStage.get(stage.id) ?? [];
                  const latestNote = stageNotes[0];
                  return (
                    <Pressable
                      key={stage.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() =>
                        setNoteTarget((current) =>
                          current ? { ...current, stage } : current
                        )
                      }
                      style={[
                        styles.noteStage,
                        {
                          backgroundColor: selected
                            ? `${stageColor}22`
                            : colors.glass,
                          borderColor: selected
                            ? stageColor
                            : colors.glassBorder,
                        },
                      ]}
                    >
                      <View
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 4,
                          backgroundColor: stageColor,
                        }}
                      />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontFamily: selected ? f.bold : f.medium,
                            color: selected ? colors.text : colors.textMuted,
                          }}
                        >
                          {stage.name}
                          {stageNotes.length > 0
                            ? ` · ${stageNotes.length} ${stageNotes.length === 1 ? 'note' : 'notes'}`
                            : ''}
                        </Text>
                        {latestNote ? (
                          <Text
                            numberOfLines={2}
                            style={{
                              fontSize: 11.5,
                              lineHeight: 16,
                              color: colors.textFaint,
                            }}
                          >
                            {latestNote.note}
                          </Text>
                        ) : null}
                      </View>
                      <Ionicons
                        name={selected ? 'radio-button-on' : 'radio-button-off'}
                        size={16}
                        color={selected ? stageColor : colors.textFaint}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {canEdit ? (
            <>
              <TextInput
                multiline
                autoFocus
                value={noteText}
                maxLength={1000}
                onChangeText={setNoteText}
                placeholder={`Add note at ${noteTarget?.stage.name ?? 'this stage'}, e.g. ₹1 lakh token paid`}
                placeholderTextColor={colors.textFaint}
                style={[
                  styles.noteInput,
                  {
                    color: colors.text,
                    backgroundColor: colors.glass,
                    borderColor: colors.glassBorder,
                  },
                ]}
              />
              <PrimaryButton
                label="Save note"
                busy={savingNote}
                disabled={!noteText.trim()}
                onPress={() => void saveNote()}
              />
            </>
          ) : null}
          {(notesQuery.data ?? []).length > 0 ? (
            <Text
              style={{
                fontSize: 11,
                fontFamily: f.bold,
                color: colors.textMuted,
                textTransform: 'uppercase',
              }}
            >
              Complete journey history
            </Text>
          ) : null}
          {!notesQuery.isLoading && (notesQuery.data ?? []).length === 0 ? (
            <Text style={{ fontSize: 13, color: colors.textFaint }}>
              No stage notes yet.
            </Text>
          ) : null}
          {(notesQuery.data ?? []).map((note) => (
            <View
              key={note.id}
              style={[
                styles.note,
                {
                  backgroundColor: colors.glass,
                  borderColor: colors.glassBorder,
                },
              ]}
            >
              <Text style={{ fontSize: 13.5, color: colors.text }}>
                {note.note}
              </Text>
              <Text
                style={{
                  marginTop: 4,
                  fontSize: 10.5,
                  color: colors.textFaint,
                }}
              >
                {note.stage_name} ·{' '}
                {note.created_by_name ? `${note.created_by_name} · ` : ''}
                {new Date(note.created_at).toLocaleDateString('en-IN')}
              </Text>
            </View>
          ))}
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        visible={moveTarget !== null}
        onClose={() => setMoveTarget(null)}
      >
        <View style={styles.sheetHeader}>
          <Text
            style={{
              flex: 1,
              fontSize: 15.5,
              fontFamily: f.bold,
              color: colors.text,
            }}
            numberOfLines={1}
          >
            Move to…
          </Text>
          <Pressable
            onPress={() => setMoveTarget(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
        <ScrollView style={sheetScrollArea}>
          {stages
            .filter((s) => s.id !== moveTarget?.stage_id)
            .map((s) => (
              <Pressable
                key={s.id}
                style={[styles.sheetRow, { borderTopColor: colors.border }]}
                onPress={() => moveTarget && void moveItem(moveTarget, s)}
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

      <BottomSheet
        visible={brokeragePrompt !== null}
        onClose={() => setBrokeragePrompt(null)}
      >
        <View style={styles.sheetHeader}>
          <Text
            style={{
              flex: 1,
              fontSize: 15.5,
              fontFamily: f.bold,
              color: colors.text,
            }}
          >
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
          {Number(brokerageValue) > 0 && brokeragePrompt ? (
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: f.bold,
                color: colors.primary,
              }}
            >
              Calculated brokerage:{' '}
              {formatInr(
                brokerageType === 'fixed'
                  ? Number(brokerageValue)
                  : (brokeragePrompt.dealValue * Number(brokerageValue)) / 100
              )}
            </Text>
          ) : null}
          <PrimaryButton
            label="Save and move"
            disabled={!(Number(brokerageValue) > 0)}
            onPress={() =>
              brokeragePrompt &&
              void moveItem(brokeragePrompt.item, brokeragePrompt.stage, {
                brokerage_type: brokerageType,
                brokerage_value: Number(brokerageValue),
              })
            }
          />
        </View>
      </BottomSheet>

      <AppDialog {...dialogProps} />
    </ScrollView>
  );
}

function DraggableJourneyCard({
  group,
  stage,
  stageById,
  mode,
  canEdit,
  index,
  count,
  expanded,
  onToggle,
  onMove,
  onActions,
  onCheckIn,
  onMoveItem,
  onConvert,
  onAddNote,
}: {
  group: JourneyGroup;
  stage?: JourneyStage;
  stageById: Map<string, JourneyStage>;
  mode: JourneyMode;
  canEdit: boolean;
  index: number;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  onMove: (from: number, to: number) => void;
  onActions: () => void;
  onCheckIn: (item: JourneyItem, stageLabel: string | undefined) => void;
  onMoveItem: (item: JourneyItem) => void;
  onConvert: (item: JourneyItem) => void;
  onAddNote: (item: JourneyItem, stage: JourneyStage) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const branchItemsQuery = useQuery({
    queryKey: ['journey-branch-items', mode, group.subjectId],
    enabled: expanded,
    queryFn: () => loadJourneyBranchItems(mode, group.subjectId),
  });
  const drag = useSharedValue(0);
  const gesture = Gesture.Pan()
    .enabled(canEdit)
    .activateAfterLongPress(220)
    .onUpdate((event) => {
      drag.value = event.translationY;
    })
    .onEnd((event) => {
      const offset = Math.round(event.translationY / 74);
      const target = Math.max(0, Math.min(count - 1, index + offset));
      if (target !== index) runOnJS(onMove)(index, target);
      drag.value = withSpring(0, { damping: 18, stiffness: 240 });
    });
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: drag.value }],
    zIndex: drag.value === 0 ? 0 : 10,
  }));
  const name = groupTitle(group, mode);
  const lifecycleLabel =
    group.lifecycleStatus === 'active'
      ? null
      : CLOSED_JOURNEY_STATUS_LABELS[group.lifecycleStatus];
  const statusLabel = [stage?.name, lifecycleLabel].filter(Boolean).join(' · ');

  return (
    <Animated.View
      style={[
        styles.card,
        { borderTopColor: colors.border, backgroundColor: colors.surfaceWell },
        animatedStyle,
      ]}
    >
      <View style={styles.cardHeader}>
        {canEdit ? (
          <GestureDetector gesture={gesture}>
            <Animated.View style={styles.dragHandle}>
              <Ionicons
                name="reorder-three"
                size={22}
                color={colors.textFaint}
              />
            </Animated.View>
          </GestureDetector>
        ) : null}
        <Pressable onPress={onToggle} style={styles.cardIdentity}>
          <Avatar name={name} size={34} />
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: 15, fontFamily: f.bold, color: colors.text }}
            >
              {name}
            </Text>
            <Text
              numberOfLines={1}
              style={{ fontSize: 11.5, color: colors.textFaint }}
            >
              {groupSubtitle(group, mode)}
              {group.captured ? ` · ${group.captured} captured` : ''}
              {group.closureReason ? ` · ${group.closureReason}` : ''}
            </Text>
          </View>
          {statusLabel ? (
            <Text
              numberOfLines={1}
              style={{
                maxWidth: 110,
                fontSize: 10.5,
                fontFamily: f.bold,
                color: stage?.color ?? colors.textMuted,
              }}
            >
              {statusLabel}
            </Text>
          ) : null}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textFaint}
          />
        </Pressable>
        {canEdit ? (
          <Pressable
            onPress={onActions}
            accessibilityLabel={`Actions for ${name}`}
            hitSlop={8}
          >
            <Ionicons
              name="ellipsis-vertical"
              size={18}
              color={colors.textMuted}
            />
          </Pressable>
        ) : null}
      </View>

      {expanded && branchItemsQuery.isLoading ? (
        <Text
          style={[
            styles.itemRow,
            { borderTopColor: colors.border, color: colors.textFaint },
          ]}
        >
          Loading journey details…
        </Text>
      ) : null}

      {expanded
        ? (branchItemsQuery.data ?? []).map((item) => {
            const itemStage = stageById.get(item.stage_id);
            const dropped = item.status === 'dropped';
            return (
              <View
                key={item.id}
                style={[styles.itemRow, { borderTopColor: colors.border }]}
              >
                <Pressable
                  style={styles.itemMain}
                  onPress={() =>
                    void onCheckIn(item, dropped ? undefined : itemStage?.name)
                  }
                  disabled={!item.contact}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: dropped
                        ? colors.danger
                        : itemStage?.color || colors.primary,
                    }}
                  />
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      fontSize: 13.5,
                      color: dropped ? colors.textFaint : colors.text,
                      textDecorationLine: dropped ? 'line-through' : 'none',
                    }}
                  >
                    {mode === 'buyer'
                      ? item.property?.title || 'Property'
                      : item.contact?.name || item.contact?.phone || 'Contact'}
                  </Text>
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: f.bold,
                      color: dropped
                        ? colors.danger
                        : itemStage?.color || colors.textMuted,
                    }}
                  >
                    {dropped
                      ? item.drop_reason || 'Dropped'
                      : itemStage?.name || '—'}
                  </Text>
                </Pressable>
                {canEdit && !dropped ? (
                  <Pressable
                    onPress={() => onMoveItem(item)}
                    accessibilityLabel="Move to stage"
                    hitSlop={8}
                  >
                    <Ionicons
                      name="arrow-forward-circle-outline"
                      size={18}
                      color={colors.textMuted}
                    />
                  </Pressable>
                ) : null}
                {canEdit && !dropped ? (
                  <Pressable
                    onPress={() => onConvert(item)}
                    accessibilityLabel="Convert to deal"
                    hitSlop={8}
                  >
                    <Ionicons
                      name="briefcase-outline"
                      size={17}
                      color={colors.textMuted}
                    />
                  </Pressable>
                ) : null}
                {itemStage ? (
                  <Pressable
                    onPress={() => onAddNote(item, itemStage)}
                    accessibilityLabel={`${canEdit ? 'Add or view' : 'View'} notes at ${itemStage.name}`}
                    hitSlop={8}
                  >
                    <Ionicons
                      name="document-text-outline"
                      size={17}
                      color={colors.textMuted}
                    />
                  </Pressable>
                ) : null}
              </View>
            );
          })
        : null}
    </Animated.View>
  );
}

async function loadJourneyBranchItems(
  mode: JourneyMode,
  subjectId: string
): Promise<JourneyItem[]> {
  const rows: JourneyItem[] = [];
  let afterId: string | null = null;
  for (;;) {
    let query = supabase
      .from('journey_items')
      .select(
        'id, contact_id, property_id, stage_id, status, drop_reason, hidden, updated_at, ' +
          'contact:contacts(id, name, phone), property:properties(id, title, property_code, location)'
      )
      .eq('hidden', false)
      .order('id', { ascending: true })
      .limit(JOURNEY_BRANCH_PAGE_SIZE);
    query =
      mode === 'buyer'
        ? query.eq('contact_id', subjectId)
        : query.eq('property_id', subjectId);
    if (afterId) query = query.gt('id', afterId);

    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as unknown as JourneyItem[];
    rows.push(...page);
    if (page.length < JOURNEY_BRANCH_PAGE_SIZE) return rows;
    afterId = page[page.length - 1].id;
  }
}

async function loadJourneyStageNotes(
  itemId: string
): Promise<JourneyStageNote[]> {
  const rows: JourneyStageNote[] = [];
  for (let from = 0; ; from += JOURNEY_NOTE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('journey_stage_notes')
      .select(
        'id, item_id, stage_id, stage_name, stage_color, note, created_by_name, created_at'
      )
      .eq('item_id', itemId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + JOURNEY_NOTE_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as JourneyStageNote[];
    rows.push(...page);
    if (page.length < JOURNEY_NOTE_PAGE_SIZE) return rows;
  }
}

function groupTitle(group: JourneyGroup, mode: JourneyMode) {
  return mode === 'buyer'
    ? group.contact?.name || group.contact?.phone || 'Unknown contact'
    : group.property?.title || 'Unknown property';
}

function groupSubtitle(group: JourneyGroup, mode: JourneyMode) {
  if (mode === 'buyer') return group.contact?.phone || '';
  return [group.property?.property_code, group.property?.location]
    .filter(Boolean)
    .join(' · ');
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  brokerageForm: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  tabs: { flexDirection: 'row', gap: spacing.xs },
  tab: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bucket: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  bucketHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  card: { borderTopWidth: StyleSheet.hairlineWidth },
  cardHeader: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  dragHandle: {
    width: 34,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  noteInput: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  noteStage: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  note: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
});
