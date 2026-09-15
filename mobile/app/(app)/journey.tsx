import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
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
import { Avatar, EmptyState, PrimaryButton } from '@/components/ui';
import {
  addJourneyStageNote,
  loadJourneyOverview,
  logPersonalWhatsAppJourneySend,
  updateJourneyOverview,
} from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { buildCheckInMessage } from '@/lib/checkin-message';
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
  JourneyOverviewState,
  JourneyStage,
  JourneyStageNote,
} from '@/lib/types';
import { usePullRefresh } from '@/lib/use-pull-refresh';

type JourneyView = 'active' | 'closed' | 'archived';
type JourneyMode = 'buyer' | 'property';
const JOURNEY_PAGE_SIZE = 1000;

interface JourneyGroup {
  subjectId: string;
  contact: JourneyItem['contact'];
  property: JourneyItem['property'];
  items: JourneyItem[];
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
  const { colors, fonts: f } = useTheme();
  const profile = useAuthStore((state) => state.profile);
  const accountId = profile?.account_id;
  const canEdit = Boolean(profile && profile.account_role !== 'viewer');
  const { show, close, dialogProps } = useAppDialog();
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
    queryKey: ['journey-stages'],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('journey_stages')
        .select('id, name, color, position')
        .order('position');
      if (error) throw error;
      return (data ?? []) as JourneyStage[];
    },
  });

  const itemsQuery = useQuery({
    queryKey: ['journey-items', accountId],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const rows: JourneyItem[] = [];
      for (let from = 0; ; from += JOURNEY_PAGE_SIZE) {
        const { data, error } = await supabase
          .from('journey_items')
          .select(
            'id, contact_id, property_id, stage_id, status, drop_reason, hidden, updated_at, ' +
              'contact:contacts(id, name, phone), property:properties(id, title, property_code, location)'
          )
          .eq('account_id', accountId!)
          .order('updated_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, from + JOURNEY_PAGE_SIZE - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as JourneyItem[];
        rows.push(...page);
        if (page.length < JOURNEY_PAGE_SIZE) return rows;
      }
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from('journey_stage_notes')
        .select(
          'id, item_id, stage_id, stage_name, stage_color, note, created_by_name, created_at'
        )
        .eq('item_id', noteTarget!.item.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as JourneyStageNote[];
    },
  });

  const pull = usePullRefresh(async () => {
    await Promise.all([
      stagesQuery.refetch(),
      itemsQuery.refetch(),
      statesQuery.refetch(),
    ]);
  });

  const stages = useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);
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
    const bySubject = new Map<string, JourneyGroup>();
    for (const item of itemsQuery.data ?? []) {
      if (mode === 'buyer' && contactId && item.contact_id !== contactId)
        continue;
      if (mode === 'property' && propertyId && item.property_id !== propertyId)
        continue;
      const subjectId = mode === 'buyer' ? item.contact_id : item.property_id;
      const state = stateBySubject.get(subjectId);
      let group = bySubject.get(subjectId);
      if (!group) {
        group = {
          subjectId,
          contact: mode === 'buyer' ? item.contact : null,
          property: mode === 'property' ? item.property : null,
          items: [],
          captured: 0,
          furthestStageIdx: -1,
          lifecycleStatus: state?.lifecycle_status ?? 'active',
          closureReason: state?.closure_reason ?? null,
          archivedAt: state?.archived_at ?? null,
          sortOrder:
            orderOverrides.get(subjectId) ??
            state?.sort_order ??
            Number.MAX_SAFE_INTEGER,
        };
        bySubject.set(subjectId, group);
      }
      if (item.hidden) group.captured += 1;
      else group.items.push(item);
      group.furthestStageIdx = Math.max(
        group.furthestStageIdx,
        stageIndexById.get(item.stage_id) ?? -1
      );
    }
    return Array.from(bySubject.values()).sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        right.furthestStageIdx - left.furthestStageIdx
    );
  }, [
    contactId,
    itemsQuery.data,
    mode,
    orderOverrides,
    propertyId,
    stageIndexById,
    stateBySubject,
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
    stagesQuery.isLoading || itemsQuery.isLoading || statesQuery.isLoading;

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
      <Stack.Screen options={{ headerShown: true, title: 'Journeys' }} />

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
        title={
          noteTarget
            ? `Journey notes · ${noteTarget.stage.name}`
            : 'Journey notes'
        }
      >
        <ScrollView
          style={sheetScrollArea}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        >
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
  onAddNote: (item: JourneyItem, stage: JourneyStage) => void;
}) {
  const { colors, fonts: f } = useTheme();
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

      {expanded
        ? group.items.map((item) => {
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
  note: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
});
