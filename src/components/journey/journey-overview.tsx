'use client';

/**
 * All-journeys overview — every relationship's funnel in one
 * scrollable place.
 *
 * One collapsible section per subject (buyers tab: one per contact
 * with journey items; properties tab: one per property). Sections
 * expand into a fully interactive embedded JourneySection — advance,
 * drop, tray, imports all work inline without leaving the page.
 *
 * Per-journey "hide" tucks a section out of the list (a view
 * preference, stored in localStorage per mode — the underlying data
 * is untouched); hidden journeys wait in a strip at the bottom.
 * Expansion state persists the same way so the layout survives
 * reloads. Only the first journey starts expanded — React Flow
 * canvases are heavy, so the rest mount lazily on click.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ChevronDown,
  Eye,
  EyeOff,
  Expand,
  Plus,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import type { Contact, JourneyItem, JourneyStage, Property } from '@/types';
import { JourneySection } from './journey-section';
import { NewJourneyDialog } from './new-journey-dialog';
import { navigateJourney, stageIndexOf, type JourneyMode } from './shared';

interface JourneyGroup {
  subjectId: string;
  contact: Contact | null;
  property: Property | null;
  active: number;
  dropped: number;
  captured: number;
  furthestStageIdx: number;
  lastUpdated: string;
}

// localStorage helpers — view preferences only, never data.
function readIdSet(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function writeIdSet(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch {
    // storage full / private mode — preference just won't persist
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
  const { accountId } = useAuth();

  const hiddenKey = `journey_overview_hidden_${mode}`;
  const openKey = `journey_overview_open_${mode}`;

  const [groups, setGroups] = useState<JourneyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() =>
    readIdSet(hiddenKey)
  );
  const [openIds, setOpenIds] = useState<Set<string> | null>(() => {
    const stored = readIdSet(openKey);
    return stored.size > 0 ? stored : null; // null = "no preference yet"
  });
  const [newJourneyOpen, setNewJourneyOpen] = useState(false);

  // Mode switch swaps the storage keys — reload both prefs.
  useEffect(() => {
    Promise.resolve().then(() => {
      setHiddenIds(readIdSet(hiddenKey));
      const stored = readIdSet(openKey);
      setOpenIds(stored.size > 0 ? stored : null);
    });
  }, [hiddenKey, openKey]);

  const loadGroups = useCallback(async () => {
    if (!accountId) return;
    const select =
      mode === 'buyer'
        ? 'id, contact_id, property_id, stage_id, status, hidden, updated_at, contact:contacts(*), property:properties(owner_contact_id)'
        : 'id, contact_id, property_id, stage_id, status, hidden, updated_at, property:properties(*)';
    const { data, error } = await supabase
      .from('journey_items')
      .select(select)
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
      .limit(2000);
    if (error) {
      console.error('Failed to load journeys:', error.message);
      setLoading(false);
      return;
    }
    const byId = new Map<string, JourneyGroup>();
    for (const row of (data ?? []) as unknown as JourneyItem[]) {
      // Owners aren't buyers for their own listing — keep self-owned
      // rows out of the buyer overview (counts and section alike).
      if (
        mode === 'buyer' &&
        row.property?.owner_contact_id === row.contact_id
      ) {
        continue;
      }
      const key = mode === 'buyer' ? row.contact_id : row.property_id;
      let g = byId.get(key);
      if (!g) {
        g = {
          subjectId: key,
          contact: mode === 'buyer' ? (row.contact ?? null) : null,
          property: mode === 'buyer' ? null : (row.property ?? null),
          active: 0,
          dropped: 0,
          captured: 0,
          furthestStageIdx: -1,
          lastUpdated: row.updated_at,
        };
        byId.set(key, g);
      }
      if (row.hidden) g.captured += 1;
      else if (row.status === 'dropped') g.dropped += 1;
      else g.active += 1;
      g.furthestStageIdx = Math.max(
        g.furthestStageIdx,
        stageIndexOf(row, stages)
      );
      if (row.updated_at > g.lastUpdated) g.lastUpdated = row.updated_at;
    }
    // Rows arrive newest-first, so map insertion order is already
    // most-recently-touched first.
    setGroups(Array.from(byId.values()));
    setLoading(false);
  }, [accountId, mode, stages, supabase]);

  useEffect(() => {
    Promise.resolve().then(() => loadGroups());
  }, [loadGroups]);

  const visibleGroups = useMemo(
    () => groups.filter((g) => !hiddenIds.has(g.subjectId)),
    [groups, hiddenIds]
  );
  const hiddenGroups = useMemo(
    () => groups.filter((g) => hiddenIds.has(g.subjectId)),
    [groups, hiddenIds]
  );

  // Default expansion: the most recently touched journey only.
  const effectiveOpen = useMemo(() => {
    if (openIds) return openIds;
    return new Set(visibleGroups.slice(0, 1).map((g) => g.subjectId));
  }, [openIds, visibleGroups]);

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

  // ✕ on a hidden chip — delete the journey outright, no confirm:
  // it only lives in the hidden strip (already one step from view),
  // and "New journey" recreates it in two taps. Items cascade their
  // events; the contact/property records are untouched.
  const deleteJourney = async (g: JourneyGroup) => {
    if (!accountId) return;
    const { error } = await supabase
      .from('journey_items')
      .delete()
      .eq('account_id', accountId)
      .eq(mode === 'buyer' ? 'contact_id' : 'property_id', g.subjectId);
    if (error) {
      toast.error(`Failed to remove: ${error.message}`);
      return;
    }
    setHidden(g.subjectId, false); // drop the stale view pref too
    toast.success(`${groupTitle(g)}'s journey removed`);
    await loadGroups();
  };

  const groupTitle = (g: JourneyGroup) =>
    mode === 'buyer'
      ? g.contact?.name || g.contact?.phone || 'Unknown contact'
      : g.property?.title || 'Unknown property';

  const groupSubtitle = (g: JourneyGroup) =>
    mode === 'buyer'
      ? (g.contact?.phone ?? '')
      : [g.property?.property_code, g.property?.location]
          .filter(Boolean)
          .join(' · ');

  if (loading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <ConvoRealLoader />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {visibleGroups.length} journey{visibleGroups.length === 1 ? '' : 's'}
          {hiddenGroups.length > 0 && ` · ${hiddenGroups.length} hidden`}
        </p>
        <Button size="sm" onClick={() => setNewJourneyOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          New journey
        </Button>
      </div>

      {visibleGroups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/50 px-6 py-12 text-center">
          <p className="text-sm text-slate-400">
            {mode === 'buyer'
              ? 'No buyer journeys yet. Share a property over WhatsApp or start one manually.'
              : "No property journeys yet. Add contacts to a property's journey to start one."}
          </p>
          <Button size="sm" onClick={() => setNewJourneyOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Start a journey
          </Button>
        </div>
      ) : (
        visibleGroups.map((g) => {
          const open = effectiveOpen.has(g.subjectId);
          const furthest =
            g.furthestStageIdx >= 0 ? stages[g.furthestStageIdx] : null;
          return (
            <div
              key={g.subjectId}
              className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40"
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleOpen(g.subjectId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleOpen(g.subjectId);
                  }
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-slate-900/80"
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
                      {groupTitle(g)}
                    </span>
                    {mode === 'buyer' && g.contact?.name && (
                      <NameTagBadge tag={g.contact.name_tag} />
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {groupSubtitle(g)}
                  </span>
                </span>

                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {furthest && (
                    <span
                      className="hidden items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:inline-flex"
                      style={{
                        borderColor: `${furthest.color}66`,
                        color: furthest.color,
                      }}
                    >
                      {furthest.name}
                    </span>
                  )}
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                    {g.active} active
                  </span>
                  {g.dropped > 0 && (
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-300">
                      {g.dropped} dropped
                    </span>
                  )}
                  {g.captured > 0 && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                      {g.captured} captured
                    </span>
                  )}
                  <button
                    type="button"
                    title="Open full screen"
                    aria-label="Open full screen"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateJourney(
                        mode === 'buyer'
                          ? `/journey?contact=${g.subjectId}`
                          : `/journey?property=${g.subjectId}`
                      );
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
                  >
                    <Expand className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Hide this journey from the overview"
                    aria-label="Hide this journey from the overview"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHidden(g.subjectId, true);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>

              {open && (
                <div className="border-t border-slate-800/70 p-3">
                  <JourneySection
                    mode={mode}
                    subjectId={g.subjectId}
                    stages={stages}
                    currency={currency}
                    canEdit={canEdit}
                    variant="embedded"
                    preloadedContact={g.contact}
                    preloadedProperty={g.property}
                    onItemsChanged={loadGroups}
                  />
                </div>
              )}
            </div>
          );
        })
      )}

      {hiddenGroups.length > 0 && (
        <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 px-3.5 py-3">
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            Hidden journeys
          </p>
          <div className="flex flex-wrap gap-2">
            {hiddenGroups.map((g) => (
              <span
                key={g.subjectId}
                className="inline-flex items-center overflow-hidden rounded-full border border-slate-700 bg-slate-900 text-[11px] text-slate-300"
              >
                <button
                  type="button"
                  onClick={() => setHidden(g.subjectId, false)}
                  title="Show this journey again"
                  className="inline-flex items-center gap-1.5 py-1 pr-1.5 pl-2.5 transition-colors hover:text-white"
                >
                  <Eye className="h-3 w-3" />
                  {groupTitle(g)}
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => deleteJourney(g)}
                    title="Remove this journey entirely (recreate any time via New journey)"
                    aria-label={`Remove ${groupTitle(g)}'s journey`}
                    className="flex h-full items-center border-l border-slate-800 px-1.5 py-1 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <NewJourneyDialog
        open={newJourneyOpen}
        onOpenChange={setNewJourneyOpen}
      />
    </div>
  );
}
