'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  GitMerge,
  Phone,
  Mail,
  ChevronDown,
  ChevronUp,
  Loader2,
  Check,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface DuplicateContact {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  source: string | null;
  classification: string | null;
  created_at: string;
  name_tag?: string | null;
}

interface DuplicateGroup {
  reason: 'phone' | 'email';
  key: string;
  contacts: DuplicateContact[];
}

interface Props {
  onMergeComplete?: () => void;
}

// Duplicate detection scans every non-merged contact on the account to
// group by normalised phone/email — there's no cheap indexed way to do
// this in SQL, so it's a full-table read. Running it unconditionally on
// every Contacts page mount was the single biggest load-time cost for
// accounts with large contact lists, so the result is cached and shared
// across navigation rather than refetched per mount.
//
// The cache has to expire. A previous version held it in sessionStorage
// and skipped the refetch whenever it read a value back — but an empty
// array is truthy, so once a check returned no groups that result stuck
// for the life of the tab, and the panel hides itself when empty. A
// duplicate created after the first visit could never surface.
const DUPLICATES_STALE_MS = 5 * 60 * 1000;

async function fetchDuplicateGroups(): Promise<DuplicateGroup[]> {
  const res = await fetch('/api/contacts/duplicates');
  if (!res.ok) throw new Error('Failed to check for duplicates');
  const data = (await res.json()) as { groups?: DuplicateGroup[] };
  return data.groups ?? [];
}

export function DuplicatesPanel({ onMergeComplete }: Props) {
  const {
    data: groups = [],
    isPending,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['contacts', 'duplicates'],
    queryFn: fetchDuplicateGroups,
    staleTime: DUPLICATES_STALE_MS,
  });
  const [expanded, setExpanded] = useState(false);

  // Merge dialog state
  const [mergeGroup, setMergeGroup] = useState<DuplicateGroup | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  async function handleMerge() {
    if (!mergeGroup || !targetId) return;
    const sourceIds = mergeGroup.contacts
      .filter((c) => c.id !== targetId)
      .map((c) => c.id);

    setMerging(true);
    try {
      // Merge all non-target contacts into the target sequentially
      for (const sourceId of sourceIds) {
        const res = await fetch('/api/contacts/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId, targetId }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Merge failed');
        }
      }
      toast.success(`Merged ${sourceIds.length + 1} contacts into one`);
      setMergeGroup(null);
      setTargetId(null);
      await refetch();
      onMergeComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setMerging(false);
    }
  }

  if (isPending) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking for duplicates…
      </div>
    );
  }

  // Rendering nothing here is what made a working check indistinguishable
  // from a removed feature: the panel had already merged everything away,
  // said so by vanishing, and left no way to ask it again.
  if (groups.length === 0) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
        <Check className="h-4 w-4 shrink-0 text-emerald-500/70" />
        <span>
          No duplicate contacts found
          {dataUpdatedAt
            ? ` — checked ${formatDistanceToNow(dataUpdatedAt, { addSuffix: true })}`
            : ''}
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          title="Re-check for duplicates"
          className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>
    );
  }

  const totalDuplicates = groups.reduce(
    (sum, g) => sum + g.contacts.length - 1,
    0
  );

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/5">
        {/* Header row */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-amber-500/5"
        >
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="flex items-center text-sm font-semibold text-amber-300">
              {groups.length} duplicate group{groups.length !== 1 ? 's' : ''}{' '}
              detected
              <InfoHint text="Duplicate check groups contacts by phone number or email address, ignoring formatting — so +919876543210 and 9876543210 count as the same person. Review each group before merging it into a single record." />
            </span>
            <Badge className="border-amber-500/30 bg-amber-500/20 text-xs text-amber-300">
              {totalDuplicates} extra
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                refetch();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  refetch();
                }
              }}
              title="Re-check for duplicates"
              className="cursor-pointer rounded p-1 text-amber-400/70 hover:bg-amber-500/10 hover:text-amber-300"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
              />
            </span>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-amber-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-amber-400" />
            )}
          </div>
        </button>

        {/* Groups list */}
        {expanded && (
          <div className="divide-y divide-amber-500/10 border-t border-amber-500/20">
            {groups.map((group, gi) => (
              <div
                key={gi}
                className="flex items-start justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-400/70">
                    {group.reason === 'phone' ? (
                      <>
                        <Phone className="h-3 w-3" /> Same phone: {group.key}
                      </>
                    ) : (
                      <>
                        <Mail className="h-3 w-3" /> Same email: {group.key}
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.contacts.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs"
                      >
                        <div className="flex items-center gap-1.5 font-medium text-white">
                          <span className="truncate">
                            {c.name || '(no name)'}
                          </span>
                          <NameTagBadge tag={c.name_tag} />
                        </div>
                        <div className="mt-0.5 text-slate-400">
                          {c.source || c.classification || 'Unknown source'} ·{' '}
                          {new Date(c.created_at).toLocaleDateString('en-IN')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-amber-500/40 text-xs text-amber-300 hover:bg-amber-500/10"
                  onClick={() => {
                    setMergeGroup(group);
                    setTargetId(group.contacts[0].id); // default: keep oldest
                  }}
                >
                  <GitMerge className="mr-1 h-3.5 w-3.5" />
                  Merge
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Merge dialog */}
      <Dialog
        open={!!mergeGroup}
        onOpenChange={(open) => {
          if (!open) {
            setMergeGroup(null);
            setTargetId(null);
          }
        }}
      >
        <DialogContent className="max-w-md border-slate-700 bg-slate-900 text-white">
          <DialogHeader>
            <DialogTitle>Merge duplicate contacts</DialogTitle>
            <DialogDescription className="text-slate-400">
              Choose which contact to keep. All conversations, notes, and tags
              from the others will be moved to the contact you keep.
            </DialogDescription>
          </DialogHeader>

          {mergeGroup && (
            <div className="my-2 space-y-2">
              {mergeGroup.contacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setTargetId(c.id)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                    targetId === c.id
                      ? 'border-primary bg-primary/10'
                      : 'border-slate-700 bg-slate-800/40 hover:border-slate-500'
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                      targetId === c.id
                        ? 'border-primary bg-primary'
                        : 'border-slate-600'
                    }`}
                  >
                    {targetId === c.id && (
                      <Check className="h-2.5 w-2.5 text-white" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-white">
                      <span className="truncate">{c.name || '(no name)'}</span>
                      <NameTagBadge tag={c.name_tag} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-400">
                      <span>{c.phone}</span>
                      {c.email && <span>{c.email}</span>}
                      {c.source && <span>{c.source}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      Added {new Date(c.created_at).toLocaleDateString('en-IN')}
                      {targetId === c.id && (
                        <span className="text-primary ml-2 font-medium">
                          ← Keep this one
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="border-slate-700 text-slate-300"
              onClick={() => {
                setMergeGroup(null);
                setTargetId(null);
              }}
              disabled={merging}
            >
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={!targetId || merging}
              className="gap-2"
            >
              {merging ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GitMerge className="h-4 w-4" />
              )}
              {merging ? 'Merging…' : 'Merge contacts'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
