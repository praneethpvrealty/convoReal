'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { GitMerge, Phone, Mail, ChevronDown, ChevronUp, Loader2, Check, RefreshCw } from 'lucide-react';
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
// accounts with large contact lists. Instead we run it once per browser
// session (cached in sessionStorage) and let the user manually re-check
// on demand, so the check still runs automatically the first time in a
// session but never blocks/duplicates work on every navigation.
const SESSION_CACHE_KEY = 'convoreal_duplicate_groups_v1';

export function DuplicatesPanel({ onMergeComplete }: Props) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Merge dialog state
  const [mergeGroup, setMergeGroup] = useState<DuplicateGroup | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  const fetchDuplicates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/contacts/duplicates');
      if (!res.ok) return;
      const data = await res.json() as { groups: DuplicateGroup[] };
      setGroups(data.groups ?? []);
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(data.groups ?? []));
        } catch {
          // sessionStorage can throw in private-browsing contexts; non-critical
        }
      }
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  // On mount, reuse a same-session result if we have one instead of
  // re-fetching the whole contacts table; otherwise run the check once.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cached: DuplicateGroup[] | null = null;
    try {
      const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (raw) cached = JSON.parse(raw) as DuplicateGroup[];
    } catch {
      cached = null;
    }
    if (cached) {
      setGroups(cached);
      return;
    }
    fetchDuplicates();
  }, [fetchDuplicates]);

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
      await fetchDuplicates();
      onMergeComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setMerging(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking for duplicates…
      </div>
    );
  }

  if (groups.length === 0) return null;

  const totalDuplicates = groups.reduce((sum, g) => sum + g.contacts.length - 1, 0);

  return (
    <>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
        {/* Header row */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-500/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-sm font-semibold text-amber-300 flex items-center">
              {groups.length} duplicate group{groups.length !== 1 ? 's' : ''} detected
              <InfoHint text="Duplicate check looks for contacts with the exact same phone number or email address, allowing you to merge them into a single record." />
            </span>
            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
              {totalDuplicates} extra
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                fetchDuplicates();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  fetchDuplicates();
                }
              }}
              title="Re-check for duplicates"
              className="p-1 rounded hover:bg-amber-500/10 text-amber-400/70 hover:text-amber-300 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
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
          <div className="border-t border-amber-500/20 divide-y divide-amber-500/10">
            {groups.map((group, gi) => (
              <div key={gi} className="px-4 py-3 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-2 text-xs text-amber-400/70">
                    {group.reason === 'phone' ? (
                      <><Phone className="h-3 w-3" /> Same phone: {group.key}</>
                    ) : (
                      <><Mail className="h-3 w-3" /> Same email: {group.key}</>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.contacts.map((c) => (
                      <div
                        key={c.id}
                        className="bg-slate-800/60 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs"
                      >
                        <div className="font-medium text-white flex items-center gap-1.5">
                          <span className="truncate">{c.name || '(no name)'}</span>
                          <NameTagBadge tag={c.name_tag} />
                        </div>
                        <div className="text-slate-400 mt-0.5">
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
                  className="shrink-0 border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-xs"
                  onClick={() => {
                    setMergeGroup(group);
                    setTargetId(group.contacts[0].id); // default: keep oldest
                  }}
                >
                  <GitMerge className="h-3.5 w-3.5 mr-1" />
                  Merge
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Merge dialog */}
      <Dialog open={!!mergeGroup} onOpenChange={(open) => { if (!open) { setMergeGroup(null); setTargetId(null); } }}>
        <DialogContent className="max-w-md bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Merge duplicate contacts</DialogTitle>
            <DialogDescription className="text-slate-400">
              Choose which contact to keep. All conversations, notes, and tags from the others will
              be moved to the contact you keep.
            </DialogDescription>
          </DialogHeader>

          {mergeGroup && (
            <div className="space-y-2 my-2">
              {mergeGroup.contacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setTargetId(c.id)}
                  className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                    targetId === c.id
                      ? 'border-primary bg-primary/10'
                      : 'border-slate-700 bg-slate-800/40 hover:border-slate-500'
                  }`}
                >
                  <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    targetId === c.id ? 'border-primary bg-primary' : 'border-slate-600'
                  }`}>
                    {targetId === c.id && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-white text-sm flex items-center gap-1.5">
                      <span className="truncate">{c.name || '(no name)'}</span>
                      <NameTagBadge tag={c.name_tag} />
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap gap-x-3">
                      <span>{c.phone}</span>
                      {c.email && <span>{c.email}</span>}
                      {c.source && <span>{c.source}</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Added {new Date(c.created_at).toLocaleDateString('en-IN')}
                      {targetId === c.id && (
                        <span className="ml-2 text-primary font-medium">← Keep this one</span>
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
              onClick={() => { setMergeGroup(null); setTargetId(null); }}
              disabled={merging}
            >
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={!targetId || merging}
              className="gap-2"
            >
              {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
              {merging ? 'Merging…' : 'Merge contacts'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
