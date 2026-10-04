'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
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
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  EllipsisVertical,
  Expand,
  Eye,
  EyeOff,
  Flag,
  Focus,
  GripVertical,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Shrink,
  Target,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { useAuth } from '@/hooks/useAuth';
import {
  CLOSED_JOURNEY_STATUS_META,
  matchesJourneySearch,
  type ClosedJourneyStatus,
  type JourneyLifecycleStatus,
  type JourneyOverviewState,
} from '@/lib/journey/overview-state';
import { dealsHref } from '@/lib/deals/routes';
import { replaceUrl } from '@/lib/navigation';
import { readStored, removeStored, writeStored } from '@/lib/safe-storage';
import { removeJourneyItems } from '@/lib/journey/remove';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type {
  Contact,
  JourneyOverviewEnquiry,
  JourneyOverviewGroup,
  JourneyStage,
  Property,
} from '@/types';
import { CloseJourneyDialog } from './close-journey-dialog';
import { EnquiriesDialog } from './enquiries-dialog';
import { JourneyListSkeleton } from './journey-list-skeleton';
import { JourneySection } from './journey-section';
import { NewJourneyDialog } from './new-journey-dialog';
import {
  DEFAULT_JOURNEY_SORT,
  JOURNEY_PRIORITY_META,
  JOURNEY_PRIORITY_ORDER,
  JOURNEY_SORT_LABELS,
  focusBuckets,
  journeyEnquiryLabel,
  journeyEnquirySourceOptions,
  journeyRaceLabel,
  journeyStageBucketKey,
  journeyViewCounts,
  matchesJourneyEnquirySource,
  navigateJourney,
  normalizeJourneyEnquirySource,
  sortJourneys,
  splitJourneysByCompartment,
  type JourneyMode,
  type JourneyPriority,
  type JourneySort,
} from './shared';
import type { JourneyCompartment } from '@/lib/journey/compartments';

type JourneyView = 'active' | 'closed' | 'archived';

interface JourneyGroup {
  subjectId: string;
  contact: Contact | null;
  property: Property | null;
  active: number;
  dropped: number;
  captured: number;
  furthestStageIdx: number;
  lostStageId: string | null;
  lastUpdated: string;
  enquiryCount: number;
  lastEnquiredAt: string | null;
  lastEnquirySource: string | null;
  enquirySourceCount: number;
  enquirySources: string[];
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
  stage?: JourneyStage;
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
  if (typeof window === 'undefined') return DEFAULT_JOURNEY_SORT;
  const stored = readStored(key);
  return stored && stored in JOURNEY_SORT_LABELS
    ? (stored as JourneySort)
    : DEFAULT_JOURNEY_SORT;
}

function readEnquirySource(key: string | null): string | null {
  if (!key || typeof window === 'undefined') return null;
  return normalizeJourneyEnquirySource(readStored(key));
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

function updatedLabel(group: JourneyGroup) {
  const date = new Date(group.lastUpdated);
  if (Number.isNaN(date.getTime())) return '';
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

function enquiredLabel(group: JourneyGroup) {
  if (!group.lastEnquiredAt) return '';
  const date = new Date(group.lastEnquiredAt);
  if (Number.isNaN(date.getTime())) return '';
  const via = group.lastEnquirySource ? ` via ${group.lastEnquirySource}` : '';
  return `Last enquired${via} ${formatDistanceToNowStrict(date, { addSuffix: true })}`;
}

function pageHrefOf(group: JourneyGroup, mode: JourneyMode) {
  return mode === 'buyer'
    ? dealsHref('journey', { contact: group.subjectId })
    : dealsHref('journey', { property: group.subjectId });
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hiddenKey = `journey_overview_hidden_${mode}`;
  const openKey = `journey_overview_open_${mode}`;
  const sortKey = `journey_overview_sort_${mode}`;
  const sourceKey = accountId
    ? `journey_overview_source_${accountId}_${mode}`
    : null;
  const collapsedKey = `journey_overview_collapsed_${mode}`;
  const passiveKey = `journey_overview_passive_open_${mode}`;
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
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() =>
    readIdSet(collapsedKey)
  );
  const [passiveOpenIds, setPassiveOpenIds] = useState<Set<string>>(() =>
    readIdSet(passiveKey)
  );
  const [focusIds, setFocusIds] = useState<Set<string>>(() => new Set());
  const [compartmentsReady, setCompartmentsReady] = useState(false);
  const [view, setView] = useState<JourneyView>('active');
  const [query, setQuery] = useState('');
  const [enquirySource, setEnquirySource] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [newJourneyOpen, setNewJourneyOpen] = useState(false);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [spotlight, setSpotlight] = useState<{
    subjectId: string;
    itemId: string;
  } | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [enquiriesId, setEnquiriesId] = useState<string | null>(null);

  useEffect(() => {
    Promise.resolve().then(() => {
      setHiddenIds(readIdSet(hiddenKey));
      const stored = readIdSet(openKey);
      setOpenIds(stored.size > 0 ? stored : null);
      setSort(readSort(sortKey));
      setCollapsedIds(readIdSet(collapsedKey));
      setPassiveOpenIds(readIdSet(passiveKey));
      setView('active');
      setQuery('');
      setShowHidden(false);
    });
  }, [collapsedKey, hiddenKey, mode, openKey, passiveKey, sortKey]);

  useEffect(() => {
    Promise.resolve().then(() => {
      setEnquirySource(readEnquirySource(sourceKey));
    });
  }, [sourceKey]);

  const stageParam = searchParams.get('stage');
  const focusedBucket =
    view === 'active' && stageParam ? `stage:${stageParam}` : null;

  const setFocusedBucket = useCallback(
    (key: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      const stageId = key?.startsWith('stage:') ? key.slice(6) : null;
      if (stageId) params.set('stage', stageId);
      else params.delete('stage');
      const search = params.toString();
      replaceUrl(router, search ? `${pathname}?${search}` : pathname);
    },
    [pathname, router, searchParams]
  );

  const changeView = (next: JourneyView) => {
    setView(next);
    if (next !== 'active' && stageParam) setFocusedBucket(null);
  };

  const changeSort = useCallback(
    (next: JourneySort) => {
      setSort(next);
      try {
        writeStored(sortKey, next);
      } catch {}
    },
    [sortKey]
  );

  const changeEnquirySource = useCallback(
    (next: string | null) => {
      setEnquirySource(next);
      if (!sourceKey) return;
      if (next) writeStored(sourceKey, next);
      else removeStored(sourceKey);
    },
    [sourceKey]
  );

  const loadGroups = useCallback(async () => {
    if (!accountId) return;
    let summariesResult;
    let prioritiesResult;
    let statesResponse;
    let enquiriesResult;
    let compartmentsResponse;
    try {
      [
        summariesResult,
        prioritiesResult,
        statesResponse,
        enquiriesResult,
        compartmentsResponse,
      ] = await Promise.all([
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
        supabase.rpc('journey_overview_enquiries', {
          p_account_id: accountId,
          p_mode: mode,
        }),
        fetch(`/api/journey/compartments?mode=${mode}`).catch(() => null),
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

    if (enquiriesResult.error) {
      toast.error(`Failed to load enquiries: ${enquiriesResult.error.message}`);
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

    const compartmentsPayload = (await compartmentsResponse
      ?.json()
      .catch(() => null)) as {
      data?: { focus?: string[] };
      error?: string;
    } | null;
    const compartmentsLoaded = Boolean(compartmentsResponse?.ok);
    setCompartmentsReady(compartmentsLoaded);
    if (compartmentsLoaded) {
      setFocusIds(new Set(compartmentsPayload?.data?.focus ?? []));
    } else {
      setFocusIds(new Set());
      toast.error(
        compartmentsPayload?.error ?? 'Failed to load the Focus list'
      );
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
    const enquiries = new Map(
      ((enquiriesResult.data ?? []) as JourneyOverviewEnquiry[]).map((row) => [
        row.subject_id,
        row,
      ])
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
          lostStageId: row.lost_stage_id ?? null,
          lastUpdated: row.last_updated,
          enquiryCount: Number(
            enquiries.get(row.subject_id)?.enquiry_count ?? 0
          ),
          lastEnquiredAt:
            enquiries.get(row.subject_id)?.last_enquired_at ?? null,
          lastEnquirySource:
            enquiries.get(row.subject_id)?.last_enquiry_source ?? null,
          enquirySourceCount: Number(
            enquiries.get(row.subject_id)?.enquiry_source_count ?? 0
          ),
          enquirySources: enquiries.get(row.subject_id)?.enquiry_sources ?? [],
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
    () => journeyViewCounts(groups, enquirySource),
    [enquirySource, groups]
  );

  const searched = useMemo(
    () => groups.filter((group) => matchesSearch(group, mode, query)),
    [groups, mode, query]
  );

  const inView = useMemo(
    () =>
      searched.filter((group) => {
        if (view === 'archived') return Boolean(group.archivedAt);
        if (group.archivedAt) return false;
        if (view === 'closed') return group.lifecycleStatus !== 'active';
        return (
          group.lifecycleStatus === 'active' && !hiddenIds.has(group.subjectId)
        );
      }),
    [hiddenIds, searched, view]
  );

  const sourceOptions = useMemo(
    () => journeyEnquirySourceOptions(inView, enquirySource),
    [enquirySource, inView]
  );

  const viewGroups = useMemo(
    () =>
      sortJourneys(
        inView.filter((group) =>
          matchesJourneyEnquirySource(group, enquirySource)
        ),
        sort
      ),
    [enquirySource, inView, sort]
  );

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
        stage,
        groups: viewGroups.filter(
          (group) =>
            group.furthestStageIdx === index || group.lostStageId === stage.id
        ),
      }));
      const unclassified = viewGroups.filter(
        (group) => group.furthestStageIdx < 0
      );
      const unclassifiedExists = groups.some(
        (group) =>
          !group.archivedAt &&
          group.lifecycleStatus === 'active' &&
          !hiddenIds.has(group.subjectId) &&
          group.furthestStageIdx < 0
      );
      return unclassified.length ||
        (focusedBucket === 'stage:unclassified' && unclassifiedExists)
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
  }, [focusedBucket, groups, hiddenIds, stages, view, viewGroups]);

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

  const showAllHidden = () => {
    setHiddenIds(new Set());
    writeIdSet(hiddenKey, new Set());
    setShowHidden(false);
  };

  const toggleCollapsed = (key: string) => {
    const next = new Set(collapsedIds);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsedIds(next);
    writeIdSet(collapsedKey, next);
  };

  const togglePassive = (key: string) => {
    const next = new Set(passiveOpenIds);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPassiveOpenIds(next);
    writeIdSet(passiveKey, next);
  };

  const setCompartment = async (
    group: JourneyGroup,
    compartment: JourneyCompartment
  ) => {
    const wasFocus = focusIds.has(group.subjectId);
    if (wasFocus === (compartment === 'focus')) return;
    const apply = (focus: boolean) =>
      setFocusIds((current) => {
        const next = new Set(current);
        if (focus) next.add(group.subjectId);
        else next.delete(group.subjectId);
        return next;
      });
    apply(compartment === 'focus');
    const res = await fetch('/api/journey/compartments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        subjectId: group.subjectId,
        compartment,
      }),
    }).catch(() => null);
    if (!res?.ok) {
      apply(wasFocus);
      const json = (await res?.json().catch(() => null)) as {
        error?: string;
      } | null;
      toast.error(json?.error ?? 'Failed to move the journey');
      return;
    }
    toast.success(
      `${titleOf(group, mode)} moved to ${compartment === 'focus' ? 'Focus' : 'Passive'}`
    );
  };

  const visibleBuckets = focusBuckets(buckets, focusedBucket);
  const focusActive =
    focusedBucket !== null &&
    visibleBuckets.length === 1 &&
    visibleBuckets[0].key === focusedBucket;

  const spotlightGroup = spotlight
    ? groups.find((group) => group.subjectId === spotlight.subjectId)
    : undefined;
  const spotlightKey =
    view === 'active' && spotlightGroup
      ? journeyStageBucketKey(spotlightGroup.furthestStageIdx, stages)
      : null;

  useEffect(() => {
    if (!spotlight || !spotlightKey) return;
    const { subjectId } = spotlight;
    Promise.resolve().then(() => {
      setOpenIds((current) => {
        const next = new Set(current ?? effectiveOpen);
        if (next.has(subjectId)) return current;
        next.add(subjectId);
        writeIdSet(openKey, next);
        return next;
      });
      setCollapsedIds((current) => {
        if (!current.has(spotlightKey)) return current;
        const next = new Set(current);
        next.delete(spotlightKey);
        writeIdSet(collapsedKey, next);
        return next;
      });
      if (!focusIds.has(subjectId)) {
        setPassiveOpenIds((current) => {
          if (current.has(spotlightKey)) return current;
          const next = new Set(current).add(spotlightKey);
          writeIdSet(passiveKey, next);
          return next;
        });
      }
    });
    if (focusedBucket && focusedBucket !== spotlightKey) {
      setFocusedBucket(spotlightKey);
    }
    const scroll = setTimeout(() => {
      document
        .getElementById(`journey-row-${spotlightKey}-${subjectId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    const release = setTimeout(() => setSpotlight(null), 5000);
    return () => {
      clearTimeout(scroll);
      clearTimeout(release);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotlight, spotlightKey]);

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
    let result: Awaited<ReturnType<typeof removeJourneyItems>>;
    try {
      result = await removeJourneyItems({ mode, subjectId: group.subjectId });
    } catch (err) {
      toast.error(
        `Failed to remove: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }
    setRemovingId(null);
    setHidden(group.subjectId, false);
    if (result.failedDeals.length > 0) {
      toast.error(
        `${titleOf(group, mode)}'s journey removed, but ${result.failedDeals.length} deal(s) could not be deleted — delete them from the Board.`
      );
    } else {
      toast.success(
        result.deals > 0
          ? `${titleOf(group, mode)}'s journey and ${result.deals} deal${result.deals === 1 ? '' : 's'} removed`
          : `${titleOf(group, mode)}'s journey removed`
      );
    }
    await loadGroups();
  };

  const fullscreenGroup = groups.find(
    (group) => group.subjectId === fullscreenId
  );
  const closingGroup = groups.find((group) => group.subjectId === closingId);
  const removingGroup = groups.find((group) => group.subjectId === removingId);
  const enquiriesGroup = groups.find(
    (group) => group.subjectId === enquiriesId
  );

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

  useEffect(() => {
    const element = toolbarRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => setToolbarHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading]);

  if (loading) {
    return <JourneyListSkeleton />;
  }

  return (
    <div
      className="space-y-3 pb-52 md:pb-28"
      style={
        { '--journey-toolbar': `${toolbarHeight}px` } as React.CSSProperties
      }
    >
      <div
        ref={toolbarRef}
        className="sticky top-0 z-20 flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/90 p-3 shadow-lg shadow-black/20 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex flex-wrap items-center gap-1">
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
              onClick={() => changeView(value)}
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
          {view === 'active' && hiddenGroups.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden((current) => !current)}
              aria-pressed={showHidden}
              title="Journeys you hid from this browser's list. They stay active for everyone else; open this to show them again."
              className={cn(
                'ml-1 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                showHidden
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  : 'border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white'
              )}
            >
              <EyeOff className="h-3.5 w-3.5" />
              <span className="tabular-nums">{hiddenGroups.length}</span> hidden
              by you
            </button>
          )}
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
          {sourceOptions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Filter by enquiry source"
                className={cn(
                  'inline-flex max-w-44 shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  enquirySource
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden truncate sm:inline">
                  {enquirySource ?? 'All sources'}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="border-slate-700 bg-slate-900"
              >
                <DropdownMenuItem onClick={() => changeEnquirySource(null)}>
                  All sources
                </DropdownMenuItem>
                {sourceOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.source}
                    onClick={() => changeEnquirySource(option.source)}
                  >
                    <span className="flex-1 truncate">{option.source}</span>
                    <span className="ml-3 text-slate-500 tabular-nums">
                      {option.count}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {enquirySource && (
            <button
              type="button"
              onClick={() => changeEnquirySource(null)}
              aria-label="Clear source filter"
              title="Clear source filter"
              className="border-primary/60 bg-primary/10 text-primary hover:bg-primary/20 inline-flex shrink-0 items-center self-stretch rounded-md border px-1.5 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
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

      {view === 'active' && showHidden && hiddenGroups.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-300">
              <span className="font-semibold text-amber-200">
                {hiddenGroups.length} hidden by you on this browser.
              </span>{' '}
              They stay active for everyone else; select one to show it again.
            </p>
            <Button variant="outline" size="sm" onClick={showAllHidden}>
              <Eye className="h-3.5 w-3.5" />
              Show all {hiddenGroups.length}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {hiddenGroups.map((group) => (
              <span
                key={group.subjectId}
                className="inline-flex items-center overflow-hidden rounded-full border border-slate-700 bg-slate-900 text-xs text-slate-300"
              >
                <button
                  type="button"
                  onClick={() => setHidden(group.subjectId, false)}
                  title={`Show ${titleOf(group, mode)}${
                    subtitleOf(group, mode)
                      ? ` · ${subtitleOf(group, mode)}`
                      : ''
                  }`}
                  className="inline-flex items-center gap-1.5 py-1 pr-1.5 pl-2.5 hover:text-white"
                >
                  <Eye className="h-3 w-3" />
                  {titleOf(group, mode)}
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setRemovingId(group.subjectId)}
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

      {sort !== 'manual' && canEdit && viewGroups.length > 1 && (
        <p className="text-xs text-slate-500">
          Choose Manual order to drag journeys into your preferred order.
        </p>
      )}

      {visibleBuckets.map((bucket) => {
        const focused = focusActive && bucket.key === focusedBucket;
        return (
          <JourneyBucketSection
            key={bucket.key}
            bucket={bucket}
            focused={focused}
            collapsed={!focused && collapsedIds.has(bucket.key)}
            query={query.trim()}
            onToggleCollapsed={() => toggleCollapsed(bucket.key)}
            onToggleFocus={() => setFocusedBucket(focused ? null : bucket.key)}
            showStage={view !== 'active'}
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
            onEnquiries={setEnquiriesId}
            onFullscreen={setFullscreenId}
            onItemsChanged={loadGroups}
            onReorder={reorderBucket}
            spotlight={spotlight}
            onItemMoved={(subjectId, itemId) =>
              setSpotlight({ subjectId, itemId })
            }
            compartments={view === 'active' && compartmentsReady}
            focusIds={focusIds}
            passiveOpen={
              Boolean(query.trim()) || passiveOpenIds.has(bucket.key)
            }
            onTogglePassive={() => togglePassive(bucket.key)}
            onCompartment={setCompartment}
          />
        );
      })}

      {viewGroups.length === 0 && !focusActive && (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-10 text-center text-sm text-slate-400">
          {query || enquirySource
            ? 'No journeys match these filters.'
            : view === 'active'
              ? 'No active journeys.'
              : view === 'closed'
                ? 'No closed journeys.'
                : 'No archived journeys.'}
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
                  navigateJourney(pageHrefOf(fullscreenGroup, mode))
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
              onItemMoved={(itemId) =>
                setSpotlight({ subjectId: fullscreenGroup.subjectId, itemId })
              }
            />
          </div>
        </div>
      )}

      <NewJourneyDialog
        open={newJourneyOpen}
        onOpenChange={setNewJourneyOpen}
      />
      <Dialog
        open={Boolean(removingGroup)}
        onOpenChange={(open) => {
          if (!open) setRemovingId(null);
        }}
      >
        <DialogContent className="border-slate-800 bg-slate-950 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Remove {removingGroup ? titleOf(removingGroup, mode) : 'this'}
              &apos;s journey?
            </DialogTitle>
            <DialogDescription>
              Every branch and its history is deleted, and any deal opened from
              a branch is deleted from the Board and Records with its documents.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemovingId(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-500"
              onClick={() => {
                if (removingGroup) void deleteJourney(removingGroup);
              }}
            >
              Remove journey and deals
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CloseJourneyDialog
        open={Boolean(closingGroup)}
        journeyName={closingGroup ? titleOf(closingGroup, mode) : 'this buyer'}
        onOpenChange={(open) => !open && setClosingId(null)}
        onSubmit={closeJourney}
      />
      <EnquiriesDialog
        mode={mode}
        subjectId={enquiriesId}
        title={enquiriesGroup ? titleOf(enquiriesGroup, mode) : ''}
        onOpenChange={(open) => !open && setEnquiriesId(null)}
      />
    </div>
  );
}

function JourneyBucketSection({
  bucket,
  focused,
  collapsed,
  query,
  onToggleCollapsed,
  onToggleFocus,
  showStage,
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
  onEnquiries,
  onFullscreen,
  onItemsChanged,
  onReorder,
  spotlight,
  onItemMoved,
  compartments,
  focusIds,
  passiveOpen,
  onTogglePassive,
  onCompartment,
}: {
  bucket: JourneyBucket;
  focused: boolean;
  collapsed: boolean;
  query: string;
  onToggleCollapsed: () => void;
  onToggleFocus: () => void;
  showStage: boolean;
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
  onEnquiries: (id: string) => void;
  onFullscreen: (id: string) => void;
  onItemsChanged: () => void;
  onReorder: (groups: JourneyGroup[], activeId: string, overId: string) => void;
  spotlight: { subjectId: string; itemId: string } | null;
  onItemMoved: (subjectId: string, itemId: string) => void;
  compartments: boolean;
  focusIds: Set<string>;
  passiveOpen: boolean;
  onTogglePassive: () => void;
  onCompartment: (group: JourneyGroup, compartment: JourneyCompartment) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const split = splitJourneysByCompartment(bucket.groups, focusIds);

  const renderList = (groups: JourneyGroup[]) => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event: DragEndEvent) => {
        if (!event.over || event.active.id === event.over.id) return;
        void onReorder(groups, String(event.active.id), String(event.over.id));
      }}
    >
      <SortableContext
        items={groups.map((group) => group.subjectId)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2">
          {groups.map((group) => (
            <SortableJourneyRow
              key={group.subjectId}
              group={group}
              bucketStage={bucket.stage ?? null}
              mode={mode}
              stages={stages}
              currency={currency}
              canEdit={canEdit}
              canDrag={canDrag}
              showStage={showStage}
              open={openIds.has(group.subjectId)}
              onToggle={() => onToggleJourney(group.subjectId)}
              onPriority={(priority) => onPriority(group, priority)}
              onCloseJourney={() => onCloseJourney(group.subjectId)}
              onLifecycle={(action) => onLifecycle(group, action)}
              onHide={() => onHide(group.subjectId, true)}
              onEnquiries={() => onEnquiries(group.subjectId)}
              onFullscreen={() => onFullscreen(group.subjectId)}
              onItemsChanged={onItemsChanged}
              rowId={`journey-row-${bucket.key}-${group.subjectId}`}
              spotlightItemId={
                spotlight?.subjectId === group.subjectId
                  ? spotlight.itemId
                  : null
              }
              onItemMoved={(itemId) => onItemMoved(group.subjectId, itemId)}
              compartment={
                compartments
                  ? focusIds.has(group.subjectId)
                    ? 'focus'
                    : 'passive'
                  : null
              }
              onCompartment={(compartment) => onCompartment(group, compartment)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );

  const showBody = !collapsed && (bucket.groups.length > 0 || focused);

  return (
    <section
      className={cn(
        'rounded-xl border bg-slate-950/40',
        focused ? 'border-transparent' : 'border-slate-800'
      )}
      style={focused ? { borderColor: bucket.color } : undefined}
    >
      <div
        className={cn(
          'sticky z-10 flex items-center gap-1.5 border-l-[3px] bg-slate-950/95 py-1.5 pr-2.5 pl-2.5 backdrop-blur-md',
          showBody ? 'rounded-t-xl' : 'rounded-xl'
        )}
        style={{
          top: 'var(--journey-toolbar, 0px)',
          borderLeftColor: bucket.color,
          boxShadow: focused
            ? `inset 0 0 0 9999px ${bucket.color}14`
            : undefined,
        }}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={showBody}
          aria-label={`${showBody ? 'Collapse' : 'Expand'} ${bucket.label}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 pl-1 text-left hover:bg-slate-900/70"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-slate-400 transition-transform',
              !showBody && '-rotate-90'
            )}
          />
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: bucket.color }}
          />
          <span className="truncate text-[13px] font-bold tracking-wide text-slate-100 uppercase">
            {bucket.label}
          </span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-200 tabular-nums">
            {bucket.groups.length}
          </span>
          {compartments && bucket.groups.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
              <Target className="h-3 w-3" />
              {split.focus.length} in focus
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onToggleFocus}
          aria-pressed={focused}
          title={focused ? 'Show all stages' : `Show only ${bucket.label}`}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-colors',
            focused
              ? 'hover:bg-slate-900/70'
              : 'border-transparent text-slate-400 hover:border-slate-700 hover:bg-slate-900/70 hover:text-white'
          )}
          style={
            focused
              ? { borderColor: `${bucket.color}99`, color: bucket.color }
              : undefined
          }
        >
          {focused ? (
            <>
              <X className="h-3.5 w-3.5" />
              All stages
            </>
          ) : (
            <>
              <Focus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Only this stage</span>
            </>
          )}
        </button>
      </div>
      {focused && bucket.groups.length === 0 && (
        <div className="flex flex-col items-center gap-2 border-t border-slate-800/70 px-6 py-8 text-center">
          <p className="text-sm text-slate-300">
            {query
              ? `No journeys in ${bucket.label} match “${query}”.`
              : `No journeys in ${bucket.label} yet.`}
          </p>
          <Button variant="outline" size="sm" onClick={onToggleFocus}>
            {query ? 'Search all stages' : 'Show all stages'}
          </Button>
        </div>
      )}
      {showBody && bucket.groups.length > 0 && (
        <div className="space-y-2 border-t border-slate-800/70 p-2.5">
          {compartments ? (
            <>
              {split.focus.length > 0 ? (
                renderList(split.focus)
              ) : (
                <p className="flex items-center gap-1.5 px-1 text-xs text-slate-500">
                  <Target className="h-3.5 w-3.5" />
                  No journeys in Focus at this stage yet. Move one up from
                  Passive to work it here.
                </p>
              )}
              {split.passive.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={onTogglePassive}
                    aria-expanded={passiveOpen}
                    className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs font-semibold text-slate-400 hover:bg-slate-900/70 hover:text-slate-200"
                  >
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 transition-transform',
                        !passiveOpen && '-rotate-90'
                      )}
                    />
                    Passive
                    <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 tabular-nums">
                      {split.passive.length}
                    </span>
                  </button>
                  {passiveOpen && renderList(split.passive)}
                </>
              )}
            </>
          ) : (
            renderList(bucket.groups)
          )}
        </div>
      )}
    </section>
  );
}

function SortableJourneyRow({
  group,
  bucketStage,
  mode,
  stages,
  currency,
  canEdit,
  canDrag,
  showStage,
  open,
  onToggle,
  onPriority,
  onCloseJourney,
  onLifecycle,
  onHide,
  onEnquiries,
  onFullscreen,
  onItemsChanged,
  rowId,
  spotlightItemId,
  onItemMoved,
  compartment,
  onCompartment,
}: {
  group: JourneyGroup;
  bucketStage: JourneyStage | null;
  mode: JourneyMode;
  stages: JourneyStage[];
  currency: string;
  canEdit: boolean;
  canDrag: boolean;
  showStage: boolean;
  open: boolean;
  onToggle: () => void;
  onPriority: (priority: JourneyPriority | null) => void;
  onCloseJourney: () => void;
  onLifecycle: (action: 'reopen' | 'archive' | 'restore') => void;
  onHide: () => void;
  onEnquiries: () => void;
  onFullscreen: () => void;
  onItemsChanged: () => void;
  rowId: string;
  spotlightItemId: string | null;
  onItemMoved: (itemId: string) => void;
  compartment: JourneyCompartment | null;
  onCompartment: (compartment: JourneyCompartment) => void;
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
      id={rowId}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className="scroll-mt-[calc(var(--journey-toolbar,0px)+56px)] overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50"
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        {canEdit && canDrag && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            title="Drag to reorder"
            aria-label={`Drag ${titleOf(group, mode)} to reorder`}
            className="touch-none text-slate-500 hover:text-slate-200"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
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
            <span className="block truncate text-xs text-slate-400">
              {subtitleOf(group, mode)}
              {group.closureReason ? ` · ${group.closureReason}` : ''}
            </span>
          </span>
        </button>

        {journeyEnquiryLabel(group) && (
          <button
            type="button"
            onClick={onEnquiries}
            title={enquiredLabel(group)}
            aria-label={`Show ${journeyEnquiryLabel(group)} for ${titleOf(group, mode)}`}
            className="bg-primary/10 text-primary hover:bg-primary/20 inline-flex max-w-64 shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
          >
            <MessageSquare className="h-3 w-3 shrink-0" />
            <span className="truncate">{journeyEnquiryLabel(group)}</span>
          </button>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className="hidden w-24 truncate text-right text-[11px] text-slate-500 lg:block"
            title={`Last updated ${updatedLabel(group)}`}
          >
            {updatedLabel(group)}
          </span>
          <span className="hidden w-20 justify-end md:flex">
            {priorityMeta && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                  priorityMeta.className
                )}
              >
                <Flag className="h-3 w-3" />
                {priorityMeta.label}
              </span>
            )}
          </span>
          {showStage && stage ? (
            <span
              className="hidden rounded-full border px-2 py-0.5 text-[11px] font-semibold sm:inline-flex"
              style={{ borderColor: `${stage.color}66`, color: stage.color }}
            >
              {stage.name}
            </span>
          ) : null}
          {lifecycleMeta ? (
            <span className="hidden rounded-full border border-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-300 md:inline-flex">
              {lifecycleMeta.label}
            </span>
          ) : null}
          {!closed && (
            <span className="hidden w-32 justify-end sm:flex">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  group.active > 0
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : 'bg-slate-800/80 text-slate-400'
                )}
              >
                {journeyRaceLabel(group.active)}
              </span>
            </span>
          )}
          {compartment && canEdit && (
            <button
              type="button"
              onClick={() =>
                onCompartment(compartment === 'focus' ? 'passive' : 'focus')
              }
              aria-pressed={compartment === 'focus'}
              title={
                compartment === 'focus' ? 'Move to Passive' : 'Move to Focus'
              }
              aria-label={`${compartment === 'focus' ? 'Move to Passive' : 'Move to Focus'}: ${titleOf(group, mode)}`}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-slate-800',
                compartment === 'focus'
                  ? 'text-primary'
                  : 'text-slate-500 hover:text-white'
              )}
            >
              <Target className="h-4 w-4" />
            </button>
          )}
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
              {compartment && canEdit && (
                <DropdownMenuItem
                  onClick={() =>
                    onCompartment(compartment === 'focus' ? 'passive' : 'focus')
                  }
                >
                  <Target className="h-3.5 w-3.5" />
                  {compartment === 'focus'
                    ? 'Move to Passive'
                    : 'Move to Focus'}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onFullscreen}>
                <Expand className="h-3.5 w-3.5" />
                Open full screen
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigateJourney(pageHrefOf(group, mode))}
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
                Open as page
              </DropdownMenuItem>
              {canEdit && (
                <>
                  <DropdownMenuSeparator />
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
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
            spotlightItemId={spotlightItemId}
            onItemMoved={onItemMoved}
            focusStageId={showStage ? null : (bucketStage?.id ?? null)}
            focusDropped={
              !showStage &&
              Boolean(bucketStage) &&
              bucketStage?.id === group.lostStageId
            }
            onFullscreen={onFullscreen}
          />
        </div>
      )}
    </div>
  );
}
