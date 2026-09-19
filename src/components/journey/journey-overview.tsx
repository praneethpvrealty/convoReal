'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Archive,
  ArchiveRestore,
  ArrowDownWideNarrow,
  Building2,
  CheckCircle2,
  ChevronDown,
  EllipsisVertical,
  Expand,
  Eye,
  EyeOff,
  Flag,
  GripVertical,
  Plus,
  RotateCcw,
  Search,
  Shrink,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { useAuth } from '@/hooks/use-auth';
import {
  CLOSED_JOURNEY_STATUS_META,
  matchesJourneySearch,
  type ClosedJourneyStatus,
  type JourneyLifecycleStatus,
  type JourneyOverviewState,
} from '@/lib/journey/overview-state';
import { dealsHref } from '@/lib/deals/routes';
import { readStored, writeStored } from '@/lib/safe-storage';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type {
  Contact,
  JourneyOverviewGroup,
  JourneyStage,
  Property,
} from '@/types';
import { CloseJourneyDialog } from './close-journey-dialog';
import { JourneySection } from './journey-section';
import { NewJourneyDialog } from './new-journey-dialog';
import {
  JOURNEY_PRIORITY_META,
  JOURNEY_PRIORITY_ORDER,
  JOURNEY_SORT_LABELS,
  navigateJourney,
  sortJourneys,
  type JourneyMode,
  type JourneyPriority,
  type JourneySort,
} from './shared';

type JourneyView = 'active' | 'closed' | 'archived';

interface JourneyGroup {
  subjectId: string;
  contact: Contact | null;
  property: Property | null;
  active: number;
  dropped: number;
  captured: number;
  furthestStageIdx: number;
  lastUpdated: string;
  priority: JourneyPriority | null;
  lifecycleStatus: JourneyLifecycleStatus;
  closureReason: string | null;
  closedAt: string | null;
  archivedAt: string | null;
  sortOrder: number;
}

interface JourneyBucket {
  key: string;
  label: string;
  color: string;
  groups: JourneyGroup[];
}

function readIdSet(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    return new Set(JSON.parse(readStored(key) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function writeIdSet(key: string, ids: Set<string>) {
  try {
    writeStored(key, JSON.stringify(Array.from(ids)));
  } catch {}
}

function readSort(key: string): JourneySort {
  if (typeof window === 'undefined') return 'manual';
  const stored = readStored(key);
  return stored === 'priority' || stored === 'recent' || stored === 'stage'
    ? stored
    : 'manual';
}

function titleOf(group: JourneyGroup, mode: JourneyMode) {
  return mode === 'buyer'
    ? group.contact?.name || group.contact?.phone || 'Unknown contact'
    : group.property?.title || 'Unknown property';
}

function subtitleOf(group: JourneyGroup, mode: JourneyMode) {
  return mode === 'buyer'
    ? (group.contact?.phone ?? '')
    : [group.property?.property_code, group.property?.location]
        .filter(Boolean)
        .join(' · ');
}

function matchesSearch(group: JourneyGroup, mode: JourneyMode, query: string) {
  const text =
    mode === 'buyer'
      ? [group.contact?.name, group.contact?.phone, group.contact?.name_tag]
      : [
          group.property?.title,
          group.property?.property_code,
          group.property?.location,
        ];
  return matchesJourneySearch(text, query);
}

async function postJourneyMutation(body: Record<string, unknown>) {
  const response = await fetch('/api/journey/overview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? 'Failed to update journey');
  }
}

export function JourneyOverview({
  mode,
  stages,
  currency,
  canEdit,
}: {
  mode: JourneyMode;
  stages: JourneyStage[];
  currency: string;
  canEdit: boolean;
}) {
  const supabase = createClient();
  const { user, accountId } = useAuth();
  const hiddenKey = `journey_overview_hidden_${mode}`;
  const openKey = `journey_overview_open_${mode}`;
  const sortKey = `journey_overview_sort_${mode}`;
  const [groups, setGroups] = useState<JourneyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() =>
    readIdSet(hiddenKey)
  );
  const [openIds, setOpenIds] = useState<Set<string> | null>(() => {
    const stored = readIdSet(openKey);
    return stored.size > 0 ? stored : null;
  });
  const [sort, setSort] = useState<JourneySort>(() => readSort(sortKey));
  const [view, setView] = useState<JourneyView>('active');
  const [query, setQuery] = useState('');
  const [openBuckets, setOpenBuckets] = useState<Set<string>>(
    () => new Set(stages[0] ? [`stage:${stages[0].id}`] : [])
  );
  const [newJourneyOpen, setNewJourneyOpen] = useState(false);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.resolve().then(() => {
      setHiddenIds(readIdSet(hiddenKey));
      const stored = readIdSet(openKey);
      setOpenIds(stored.size > 0 ? stored : null);
      setSort(readSort(sortKey));
      setView('active');
      setQuery('');
      setOpenBuckets(new Set(stages[0] ? [`stage:${stages[0].id}`] : []));
    });
  }, [hiddenKey, mode, openKey, sortKey, stages]);

  const changeSort = useCallback(
    (next: JourneySort) => {
      setSort(next);
      try {
        writeStored(sortKey, next);
      } catch {}
    },
    [sortKey]
  );

  const loadGroups = useCallback(async () => {
    if (!accountId) return;
    let summariesResult;
    let prioritiesResult;
    let statesResponse;
    try {
      [summariesResult, prioritiesResult, statesResponse] = await Promise.all([
        supabase.rpc('journey_overview_groups', {
          p_account_id: accountId,
          p_mode: mode,
        }),
        supabase
          .from('journey_priorities')
          .select('subject_id, priority')
          .eq('account_id', accountId)
          .eq('mode', mode),
        fetch(`/api/journey/overview?mode=${mode}`),
      ]);
    } catch (error) {
      toast.error(
        `Failed to load journeys: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      setLoading(false);
      return;
    }

    if (summariesResult.error) {
      toast.error(`Failed to load journeys: ${summariesResult.error.message}`);
      setLoading(false);
      return;
    }

    const statePayload = (await statesResponse.json().catch(() => null)) as {
      data?: JourneyOverviewState[];
      error?: string;
    } | null;
    if (!statesResponse.ok) {
      toast.error(statePayload?.error ?? 'Failed to load journey status');
      setLoading(false);
      return;
    }

    const priorities = new Map<string, JourneyPriority>(
      (
        (prioritiesResult.data ?? []) as {
          subject_id: string;
          priority: JourneyPriority;
        }[]
      ).map((row) => [row.subject_id, row.priority])
    );
    const states = new Map(
      (statePayload?.data ?? []).map((row) => [row.subject_id, row])
    );
    const summaries = (summariesResult.data ?? []) as JourneyOverviewGroup[];
    setGroups(
      summaries.map((row) => {
        const state = states.get(row.subject_id);
        return {
          subjectId: row.subject_id,
          contact:
            mode === 'buyer'
              ? ({
                  id: row.subject_id,
                  name: row.contact_name,
                  phone: row.contact_phone,
                  name_tag: row.contact_name_tag,
                } as Contact)
              : null,
          property:
            mode === 'property'
              ? ({
                  id: row.subject_id,
                  title: row.property_title,
                  property_code: row.property_code,
                  location: row.property_location,
                } as Property)
              : null,
          active: Number(row.active_count),
          dropped: Number(row.dropped_count),
          captured: Number(row.captured_count),
          furthestStageIdx: stages.findIndex(
            (stage) => stage.id === row.furthest_stage_id
          ),
          lastUpdated: row.last_updated,
          priority: priorities.get(row.subject_id) ?? null,
          lifecycleStatus: state?.lifecycle_status ?? 'active',
          closureReason: state?.closure_reason ?? null,
          closedAt: state?.closed_at ?? null,
          archivedAt: state?.archived_at ?? null,
          sortOrder: state?.sort_order ?? Number.MAX_SAFE_INTEGER,
        };
      })
    );
    setLoading(false);
  }, [accountId, mode, stages, supabase]);

  useEffect(() => {
    Promise.resolve().then(() => loadGroups());
  }, [loadGroups]);

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

  const searched = useMemo(
    () => groups.filter((group) => matchesSearch(group, mode, query)),
    [groups, mode, query]
  );

  const viewGroups = useMemo(() => {
    const filtered = searched.filter((group) => {
      if (view === 'archived') return Boolean(group.archivedAt);
      if (group.archivedAt) return false;
      if (view === 'closed') return group.lifecycleStatus !== 'active';
      return (
        group.lifecycleStatus === 'active' && !hiddenIds.has(group.subjectId)
      );
    });
    return sortJourneys(filtered, sort);
  }, [hiddenIds, searched, sort, view]);

  const hiddenGroups = useMemo(
    () =>
      searched.filter(
        (group) =>
          !group.archivedAt &&
          group.lifecycleStatus === 'active' &&
          hiddenIds.has(group.subjectId)
      ),
    [hiddenIds, searched]
  );

  const buckets = useMemo<JourneyBucket[]>(() => {
    if (view === 'active') {
      const stageBuckets = stages.map((stage, index) => ({
        key: `stage:${stage.id}`,
        label: stage.name,
        color: stage.color,
        groups: viewGroups.filter((group) => group.furthestStageIdx === index),
      }));
      const unclassified = viewGroups.filter(
        (group) => group.furthestStageIdx < 0
      );
      return unclassified.length
        ? [
            ...stageBuckets,
            {
              key: 'stage:unclassified',
              label: 'Unclassified',
              color: '#64748b',
              groups: unclassified,
            },
          ]
        : stageBuckets;
    }
    if (view === 'closed') {
      return (
        Object.keys(CLOSED_JOURNEY_STATUS_META) as ClosedJourneyStatus[]
      ).map((status) => ({
        key: `closed:${status}`,
        label: CLOSED_JOURNEY_STATUS_META[status].label,
        color:
          status === 'completed'
            ? '#22c55e'
            : status === 'paused'
              ? '#f59e0b'
              : '#64748b',
        groups: viewGroups.filter((group) => group.lifecycleStatus === status),
      }));
    }
    return [
      {
        key: 'archived',
        label: 'Archived journeys',
        color: '#64748b',
        groups: viewGroups,
      },
    ];
  }, [stages, view, viewGroups]);

  const effectiveOpen = useMemo(() => {
    if (openIds) return openIds;
    return new Set(viewGroups.slice(0, 1).map((group) => group.subjectId));
  }, [openIds, viewGroups]);

  const toggleOpen = (id: string) => {
    const next = new Set(effectiveOpen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenIds(next);
    writeIdSet(openKey, next);
  };

  const setHidden = (id: string, hidden: boolean) => {
    const next = new Set(hiddenIds);
    if (hidden) next.add(id);
    else next.delete(id);
    setHiddenIds(next);
    writeIdSet(hiddenKey, next);
  };

  const toggleBucket = (key: string) => {
    const next = new Set(openBuckets);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenBuckets(next);
  };

  const setPriority = async (
    group: JourneyGroup,
    priority: JourneyPriority | null
  ) => {
    if (!accountId) return;
    const previous = group.priority;
    setGroups((current) =>
      current.map((candidate) =>
        candidate.subjectId === group.subjectId
          ? { ...candidate, priority }
          : candidate
      )
    );
    const { data, error } = priority
      ? await supabase
          .from('journey_priorities')
          .upsert(
            {
              account_id: accountId,
              mode,
              subject_id: group.subjectId,
              priority,
              created_by: user?.id ?? null,
            },
            { onConflict: 'account_id,mode,subject_id' }
          )
          .select('id')
      : await supabase
          .from('journey_priorities')
          .delete()
          .eq('account_id', accountId)
          .eq('mode', mode)
          .eq('subject_id', group.subjectId)
          .select('id');
    if (error || (priority && !data?.length)) {
      setGroups((current) =>
        current.map((candidate) =>
          candidate.subjectId === group.subjectId
            ? { ...candidate, priority: previous }
            : candidate
        )
      );
      toast.error(`Failed to set priority${error ? `: ${error.message}` : ''}`);
    }
  };

  const mutateLifecycle = async (
    group: JourneyGroup,
    action: 'reopen' | 'archive' | 'restore'
  ) => {
    try {
      await postJourneyMutation({ action, mode, subjectId: group.subjectId });
      toast.success(
        action === 'archive'
          ? 'Journey archived'
          : action === 'restore'
            ? 'Journey restored'
            : 'Journey reopened'
      );
      await loadGroups();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update journey'
      );
    }
  };

  const closeJourney = async (status: ClosedJourneyStatus, reason: string) => {
    const group = groups.find((candidate) => candidate.subjectId === closingId);
    if (!group) return;
    try {
      await postJourneyMutation({
        action: 'close',
        mode,
        subjectId: group.subjectId,
        status,
        reason,
      });
      toast.success('Journey closed and filed by outcome');
      await loadGroups();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to close journey'
      );
      throw error;
    }
  };

  const reorderBucket = async (
    bucketGroups: JourneyGroup[],
    activeId: string,
    overId: string
  ) => {
    const oldIndex = bucketGroups.findIndex(
      (group) => group.subjectId === activeId
    );
    const newIndex = bucketGroups.findIndex(
      (group) => group.subjectId === overId
    );
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
    const reordered = arrayMove(bucketGroups, oldIndex, newIndex);
    const positions = new Map(
      reordered.map((group, index) => [group.subjectId, index])
    );
    changeSort('manual');
    setGroups((current) =>
      current.map((group) =>
        positions.has(group.subjectId)
          ? { ...group, sortOrder: positions.get(group.subjectId)! }
          : group
      )
    );
    try {
      await postJourneyMutation({
        action: 'reorder',
        mode,
        subjectIds: reordered.map((group) => group.subjectId),
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save order'
      );
      await loadGroups();
    }
  };

  const deleteJourney = async (group: JourneyGroup) => {
    if (!accountId) return;
    const { data: removed, error } = await supabase
      .from('journey_items')
      .delete()
      .eq('account_id', accountId)
      .eq(mode === 'buyer' ? 'contact_id' : 'property_id', group.subjectId)
      .select('id');
    if (error || !removed?.length) {
      toast.error(
        error ? `Failed to remove: ${error.message}` : 'Nothing was removed'
      );
      return;
    }
    setHidden(group.subjectId, false);
    toast.success(`${titleOf(group, mode)}'s journey removed`);
    await loadGroups();
  };

  const fullscreenGroup = groups.find(
    (group) => group.subjectId === fullscreenId
  );
  const closingGroup = groups.find((group) => group.subjectId === closingId);

  useEffect(() => {
    if (!fullscreenGroup) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreenId(null);
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [fullscreenGroup]);

  if (loading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <ConvoRealLoader />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['active', 'Active'],
              ['closed', 'Closed'],
              ['archived', 'Archived'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                view === value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              )}
            >
              {label} <span className="ml-1 tabular-nums">{counts[value]}</span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                mode === 'buyer'
                  ? 'Search name or mobile…'
                  : 'Search property, code or location…'
              }
              className="h-8 border-slate-700 bg-slate-950 pr-8 pl-8 text-sm"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear journey search"
                onClick={() => setQuery('')}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800">
              <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {JOURNEY_SORT_LABELS[sort]}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-slate-700 bg-slate-900"
            >
              {(Object.keys(JOURNEY_SORT_LABELS) as JourneySort[]).map(
                (option) => (
                  <DropdownMenuItem
                    key={option}
                    onClick={() => changeSort(option)}
                  >
                    {JOURNEY_SORT_LABELS[option]}
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {view === 'active' && (
            <Button size="sm" onClick={() => setNewJourneyOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">New journey</span>
            </Button>
          )}
        </div>
      </div>

      {sort !== 'manual' && canEdit && viewGroups.length > 1 && (
        <p className="text-[11px] text-slate-500">
          Choose Manual order to drag journeys into your preferred order.
        </p>
      )}

      {buckets.map((bucket) => {
        const open = query.trim() ? true : openBuckets.has(bucket.key);
        return (
          <JourneyBucketSection
            key={bucket.key}
            bucket={bucket}
            open={open}
            onToggle={() => toggleBucket(bucket.key)}
            mode={mode}
            stages={stages}
            currency={currency}
            canEdit={canEdit}
            canDrag={sort === 'manual'}
            openIds={effectiveOpen}
            onToggleJourney={toggleOpen}
            onPriority={setPriority}
            onCloseJourney={setClosingId}
            onLifecycle={mutateLifecycle}
            onHide={setHidden}
            onFullscreen={setFullscreenId}
            onItemsChanged={loadGroups}
            onReorder={reorderBucket}
          />
        );
      })}

      {viewGroups.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-10 text-center text-sm text-slate-400">
          {query
            ? 'No journeys match this search.'
            : view === 'active'
              ? 'No active journeys.'
              : view === 'closed'
                ? 'No closed journeys.'
                : 'No archived journeys.'}
        </div>
      )}

      {view === 'active' && hiddenGroups.length > 0 && (
        <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 px-3.5 py-3">
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            Hidden on this device · {hiddenGroups.length}
          </p>
          <div className="flex flex-wrap gap-2">
            {hiddenGroups.map((group) => (
              <span
                key={group.subjectId}
                className="inline-flex items-center overflow-hidden rounded-full border border-slate-700 bg-slate-900 text-[11px] text-slate-300"
              >
                <button
                  type="button"
                  onClick={() => setHidden(group.subjectId, false)}
                  className="inline-flex items-center gap-1.5 py-1 pr-1.5 pl-2.5 hover:text-white"
                >
                  <Eye className="h-3 w-3" />
                  {titleOf(group, mode)}
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => deleteJourney(group)}
                    aria-label={`Remove ${titleOf(group, mode)}'s journey`}
                    className="flex h-full items-center border-l border-slate-800 px-1.5 py-1 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {fullscreenGroup && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-2.5">
            <span className="truncate text-sm font-semibold text-white">
              {titleOf(fullscreenGroup, mode)}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigateJourney(
                    mode === 'buyer'
                      ? dealsHref('journey', {
                          contact: fullscreenGroup.subjectId,
                        })
                      : dealsHref('journey', {
                          property: fullscreenGroup.subjectId,
                        })
                  )
                }
              >
                Open as page
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFullscreenId(null)}
              >
                <Shrink className="h-3.5 w-3.5" />
                Close
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <JourneySection
              mode={mode}
              subjectId={fullscreenGroup.subjectId}
              stages={stages}
              currency={currency}
              canEdit={canEdit}
              variant="fullscreen"
              preloadedContact={fullscreenGroup.contact}
              preloadedProperty={fullscreenGroup.property}
              onItemsChanged={loadGroups}
            />
          </div>
        </div>
      )}

      <NewJourneyDialog
        open={newJourneyOpen}
        onOpenChange={setNewJourneyOpen}
      />
      <CloseJourneyDialog
        open={Boolean(closingGroup)}
        journeyName={closingGroup ? titleOf(closingGroup, mode) : 'this buyer'}
        onOpenChange={(open) => !open && setClosingId(null)}
        onSubmit={closeJourney}
      />
    </div>
  );
}

function JourneyBucketSection({
  bucket,
  open,
  onToggle,
  mode,
  stages,
  currency,
  canEdit,
  canDrag,
  openIds,
  onToggleJourney,
  onPriority,
  onCloseJourney,
  onLifecycle,
  onHide,
  onFullscreen,
  onItemsChanged,
  onReorder,
}: {
  bucket: JourneyBucket;
  open: boolean;
  onToggle: () => void;
  mode: JourneyMode;
  stages: JourneyStage[];
  currency: string;
  canEdit: boolean;
  canDrag: boolean;
  openIds: Set<string>;
  onToggleJourney: (id: string) => void;
  onPriority: (group: JourneyGroup, priority: JourneyPriority | null) => void;
  onCloseJourney: (id: string) => void;
  onLifecycle: (
    group: JourneyGroup,
    action: 'reopen' | 'archive' | 'restore'
  ) => void;
  onHide: (id: string, hidden: boolean) => void;
  onFullscreen: (id: string) => void;
  onItemsChanged: () => void;
  onReorder: (groups: JourneyGroup[], activeId: string, overId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    void onReorder(
      bucket.groups,
      String(event.active.id),
      String(event.over.id)
    );
  };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left hover:bg-slate-900/70"
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 text-slate-500 transition-transform',
            !open && '-rotate-90'
          )}
        />
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: bucket.color }}
        />
        <span className="flex-1 text-sm font-bold text-slate-200">
          {bucket.label}
        </span>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-300 tabular-nums">
          {bucket.groups.length}
        </span>
      </button>
      {open && bucket.groups.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={bucket.groups.map((group) => group.subjectId)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2 border-t border-slate-800/70 p-2.5">
              {bucket.groups.map((group) => (
                <SortableJourneyRow
                  key={group.subjectId}
                  group={group}
                  mode={mode}
                  stages={stages}
                  currency={currency}
                  canEdit={canEdit}
                  canDrag={canDrag}
                  open={openIds.has(group.subjectId)}
                  onToggle={() => onToggleJourney(group.subjectId)}
                  onPriority={(priority) => onPriority(group, priority)}
                  onCloseJourney={() => onCloseJourney(group.subjectId)}
                  onLifecycle={(action) => onLifecycle(group, action)}
                  onHide={() => onHide(group.subjectId, true)}
                  onFullscreen={() => onFullscreen(group.subjectId)}
                  onItemsChanged={onItemsChanged}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

function SortableJourneyRow({
  group,
  mode,
  stages,
  currency,
  canEdit,
  canDrag,
  open,
  onToggle,
  onPriority,
  onCloseJourney,
  onLifecycle,
  onHide,
  onFullscreen,
  onItemsChanged,
}: {
  group: JourneyGroup;
  mode: JourneyMode;
  stages: JourneyStage[];
  currency: string;
  canEdit: boolean;
  canDrag: boolean;
  open: boolean;
  onToggle: () => void;
  onPriority: (priority: JourneyPriority | null) => void;
  onCloseJourney: () => void;
  onLifecycle: (action: 'reopen' | 'archive' | 'restore') => void;
  onHide: () => void;
  onFullscreen: () => void;
  onItemsChanged: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.subjectId, disabled: !canEdit || !canDrag });
  const priorityMeta = group.priority
    ? JOURNEY_PRIORITY_META[group.priority]
    : null;
  const stage =
    group.furthestStageIdx >= 0 ? stages[group.furthestStageIdx] : null;
  const closedStatus =
    group.lifecycleStatus === 'active' ? null : group.lifecycleStatus;
  const closed = closedStatus !== null;
  const lifecycleMeta = closedStatus
    ? CLOSED_JOURNEY_STATUS_META[closedStatus]
    : null;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50"
    >
      <div className="flex items-center gap-2 px-2.5 py-2.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={!canEdit || !canDrag}
          title={canDrag ? 'Drag to reorder' : 'Choose Manual order to drag'}
          aria-label={`Drag ${titleOf(group, mode)} to reorder`}
          className="touch-none text-slate-600 hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-slate-500 transition-transform',
              !open && '-rotate-90'
            )}
          />
          <span className="bg-primary/10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
            {mode === 'buyer' ? (
              <UserRound className="text-primary h-3.5 w-3.5" />
            ) : (
              <Building2 className="text-primary h-3.5 w-3.5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-bold text-white">
                {titleOf(group, mode)}
              </span>
              {mode === 'buyer' && group.contact?.name && (
                <NameTagBadge tag={group.contact.name_tag} />
              )}
            </span>
            <span className="block truncate text-[11px] text-slate-500">
              {subtitleOf(group, mode)}
              {group.closureReason ? ` · ${group.closureReason}` : ''}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {priorityMeta && (
            <span
              className={cn(
                'hidden items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold md:inline-flex',
                priorityMeta.className
              )}
            >
              <Flag className="h-3 w-3" />
              {priorityMeta.label}
            </span>
          )}
          {stage ? (
            <span
              className="hidden rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:inline-flex"
              style={{ borderColor: `${stage.color}66`, color: stage.color }}
            >
              {stage.name}
            </span>
          ) : null}
          {lifecycleMeta ? (
            <span className="hidden rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300 md:inline-flex">
              {lifecycleMeta.label}
            </span>
          ) : null}
          <span className="hidden rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 lg:inline-flex">
            {group.active} active
          </span>
          <button
            type="button"
            onClick={onFullscreen}
            title="Open full screen"
            className="hidden h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-white sm:flex"
          >
            <Expand className="h-3.5 w-3.5" />
          </button>
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Journey actions for ${titleOf(group, mode)}`}
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-white"
              >
                <EllipsisVertical className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="border-slate-700 bg-slate-900"
              >
                <DropdownMenuItem
                  disabled
                  className="text-[10px] text-slate-500 uppercase"
                >
                  Priority
                </DropdownMenuItem>
                {JOURNEY_PRIORITY_ORDER.map((priority) => (
                  <DropdownMenuItem
                    key={priority}
                    onClick={() => onPriority(priority)}
                  >
                    <Flag
                      className={cn(
                        'h-3.5 w-3.5',
                        JOURNEY_PRIORITY_META[priority].dot
                      )}
                    />
                    {JOURNEY_PRIORITY_META[priority].label}
                  </DropdownMenuItem>
                ))}
                {group.priority && (
                  <DropdownMenuItem onClick={() => onPriority(null)}>
                    Clear priority
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {group.archivedAt ? (
                  <DropdownMenuItem onClick={() => onLifecycle('restore')}>
                    <ArchiveRestore className="h-3.5 w-3.5" />
                    Restore from archive
                  </DropdownMenuItem>
                ) : (
                  <>
                    {closed ? (
                      <DropdownMenuItem onClick={() => onLifecycle('reopen')}>
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reopen journey
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={onCloseJourney}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Close with outcome…
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => onLifecycle('archive')}>
                      <Archive className="h-3.5 w-3.5" />
                      Archive journey
                    </DropdownMenuItem>
                    {!closed && (
                      <DropdownMenuItem onClick={onHide}>
                        <EyeOff className="h-3.5 w-3.5" />
                        Hide on this device
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-800/70 p-3">
          <JourneySection
            mode={mode}
            subjectId={group.subjectId}
            stages={stages}
            currency={currency}
            canEdit={canEdit}
            variant="embedded"
            preloadedContact={group.contact}
            preloadedProperty={group.property}
            onItemsChanged={onItemsChanged}
          />
        </div>
      )}
    </div>
  );
}
