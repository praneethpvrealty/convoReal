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
  Users,
  X,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { diffContacts } from '@/lib/contacts/duplicate-diff';
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
  status?: string | null;
  company?: string | null;
  second_name?: string | null;
  requirements?: string | null;
  min_budget?: number | null;
  max_budget?: number | null;
  areas_of_interest?: string[] | null;
  property_interests?: string[] | null;
  last_contacted_at?: string | null;
}

interface DuplicateGroup {
  reason: 'phone' | 'email' | 'name';
  key: string;
  contacts: DuplicateContact[];
}

interface Props {
  onMergeComplete?: () => void;
  /** Opens the contact card, so a record can be corrected rather than
   *  merged — often the right answer once you can see the difference. */
  onOpenContact?: (contactId: string) => void;
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

function groupIds(group: DuplicateGroup): string {
  return group.contacts.map((c) => c.id).sort().join(':');
}

async function fetchDuplicateGroups(): Promise<DuplicateGroup[]> {
  const res = await fetch('/api/contacts/duplicates');
  if (!res.ok) throw new Error('Failed to check for duplicates');
  const data = (await res.json()) as { groups?: DuplicateGroup[] };
  return data.groups ?? [];
}

// Deciding a merge from a name and a source alone is how an Owner gets
// folded into a Buyer who happens to share their name. This puts the
// difference in front of whoever is deciding, on the row they are
// deciding on, rather than a tab away in two contact records.
function ContactDifferences({ contacts }: { contacts: DuplicateContact[] }) {
  const [open, setOpen] = useState(false);
  const differences = diffContacts(contacts);

  if (differences.length === 0) {
    return (
      <p className="mt-2 text-xs text-slate-500">
        These records hold the same details wherever both are filled in.
      </p>
    );
  }

  const conflicts = differences.filter((d) => d.conflict).length;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-1 text-xs text-amber-400/80 hover:text-amber-300"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? 'Hide' : 'Compare'} {differences.length} difference
        {differences.length !== 1 ? 's' : ''}
        {conflicts > 0 ? ` · ${conflicts} conflicting` : ''}
      </button>

      {open && (
        <table className="mt-2 w-full table-fixed text-xs">
          <tbody>
            {differences.map((d) => (
              <tr key={d.label} className="align-top">
                <td className="w-32 py-1 pr-2 text-slate-500">{d.label}</td>
                {d.values.map((v, i) => (
                  <td
                    key={i}
                    className={`py-1 pr-3 break-words ${
                      d.conflict ? 'text-amber-300' : 'text-slate-300'
                    }`}
                  >
                    {v || <span className="text-slate-600">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function DuplicatesPanel({ onMergeComplete, onOpenContact }: Props) {
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
  const [dismissing, setDismissing] = useState<string | null>(null);

  // A pair the panel is right to suggest and you are right to reject comes
  // back on every check, so the answer has to be recordable. Offered with
  // an undo because a suggestion that vanishes for good on one misclick is
  // worse than one that keeps asking.
  async function handleDismiss(group: DuplicateGroup) {
    const contactIds = group.contacts.map((c) => c.id);
    setDismissing(groupIds(group));
    try {
      const res = await fetch('/api/contacts/duplicates/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not dismiss');
      await refetch();
      toast.success('Marked as different people', {
        action: {
          label: 'Undo',
          onClick: async () => {
            await fetch('/api/contacts/duplicates/dismiss', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contactIds }),
            });
            await refetch();
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not dismiss');
    } finally {
      setDismissing(null);
    }
  }

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
              <InfoHint text="Duplicate check groups contacts by phone number or email address, ignoring formatting — so +919876543210 and 9876543210 count as the same person. It also flags contacts with the same full name on different numbers, which is a weaker signal worth reading carefully. Review each group before merging it into a single record." />
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
                    {group.reason === 'phone' && (
                      <>
                        <Phone className="h-3 w-3" /> Same phone: {group.key}
                      </>
                    )}
                    {group.reason === 'email' && (
                      <>
                        <Mail className="h-3 w-3" /> Same email: {group.key}
                      </>
                    )}
                    {group.reason === 'name' && (
                      <>
                        <Users className="h-3 w-3" /> Similar name: {group.key}
                        <span className="text-amber-400/50">
                          · different numbers, so check before merging
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.contacts.map((c) => (
                      // Not every pair resolves to merge-or-ignore: seeing
                      // the difference is often what tells you one record
                      // is simply wrong. Open it and fix it in place.
                      <button
                        key={c.id}
                        type="button"
                        disabled={!onOpenContact}
                        onClick={() => onOpenContact?.(c.id)}
                        title={onOpenContact ? 'Open this contact' : undefined}
                        className="rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-left text-xs enabled:cursor-pointer enabled:hover:border-slate-600 enabled:hover:bg-slate-800"
                      >
                        <div className="flex items-center gap-1.5 font-medium text-white">
                          <span className="truncate">
                            {c.name || '(no name)'}
                          </span>
                          <NameTagBadge tag={c.name_tag} />
                          {onOpenContact && (
                            <ExternalLink className="h-3 w-3 shrink-0 text-slate-500" />
                          )}
                        </div>
                        <div className="mt-0.5 text-slate-400">
                          {c.source || c.classification || 'Unknown source'} ·{' '}
                          {new Date(c.created_at).toLocaleDateString('en-IN')}
                        </div>
                      </button>
                    ))}
                  </div>
                  <ContactDifferences contacts={group.contacts} />
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-500/40 text-xs text-amber-300 hover:bg-amber-500/10"
                    onClick={() => {
                      setMergeGroup(group);
                      setTargetId(group.contacts[0].id); // default: keep oldest
                    }}
                  >
                    <GitMerge className="mr-1 h-3.5 w-3.5" />
                    Merge
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={dismissing === groupIds(group)}
                    className="text-xs text-slate-400 hover:text-slate-200"
                    onClick={() => handleDismiss(group)}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Not duplicates
                  </Button>
                </div>
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
