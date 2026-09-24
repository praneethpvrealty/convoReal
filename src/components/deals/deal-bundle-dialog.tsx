'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import {
  BUNDLE_MAX_DEALS,
  bundleBlocker,
  bundleCandidateLabel,
  bundleCandidates,
  defaultBundleName,
  sameBuyerIds,
  type BundleCandidate,
} from '@/lib/deals/bundles';
import { formatIndianDigits } from '@/lib/invoices/pdf-text';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

interface BundleAnchorDeal {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  group: { id: string; name: string } | null;
}

interface BundleMember {
  id: string;
  title: string;
  value: number | null;
  stage: { name: string; color: string | null } | null;
  contact: { name: string | null; second_name: string | null } | null;
  property: { title: string | null; unit_no: string | null } | null;
  progress: { total: number; done: number };
}

interface BundleDetail {
  id: string;
  name: string;
  deals: BundleMember[];
  progress: { total: number; done: number };
}

type CandidateRow = Omit<
  BundleCandidate,
  'contact_name' | 'property_title' | 'property_unit_no' | 'stage_name'
> & {
  contact: { name: string | null; second_name: string | null } | null;
  property: { title: string | null; unit_no: string | null } | null;
  stage: { name: string } | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export function DealBundleDialog({
  deal,
  open,
  onOpenChange,
}: {
  deal: BundleAnchorDeal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-900 text-slate-200 sm:max-w-lg">
        {deal.group ? (
          <BundleMembers group={deal.group} currentDealId={deal.id} />
        ) : (
          <CreateBundle deal={deal} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateBundle({
  deal,
  onDone,
}: {
  deal: BundleAnchorDeal;
  onDone: () => void;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { accountId } = useAuth();
  const [name, setName] = useState(() => defaultBundleName(deal.contact_name));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['deal-bundle-candidates', accountId, deal.id],
    queryFn: async (): Promise<BundleCandidate[]> => {
      const { data, error } = await supabase
        .from('deals')
        .select(
          'id, title, contact_id, deal_group_id, ' +
            'contact:contacts(name, second_name), ' +
            'property:properties(title, unit_no), ' +
            'stage:pipeline_stages(name)'
        )
        .eq('account_id', accountId!)
        .is('deal_group_id', null)
        .not('status', 'in', '("won","lost")')
        .order('updated_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as CandidateRow[]).map((row) => {
        const contact = one(row.contact);
        const property = one(row.property);
        return {
          id: row.id,
          title: row.title,
          contact_id: row.contact_id,
          deal_group_id: row.deal_group_id,
          contact_name:
            [contact?.name, contact?.second_name].filter(Boolean).join(' ') ||
            null,
          property_title: property?.title ?? null,
          property_unit_no: property?.unit_no ?? null,
          stage_name: one(row.stage)?.name ?? null,
        };
      });
    },
    enabled: Boolean(accountId),
  });

  const candidates = useMemo(() => bundleCandidates(rows, deal), [rows, deal]);

  useEffect(() => {
    if (seeded || isLoading) return;
    setSeeded(true);
    setSelected(new Set(sameBuyerIds(candidates, deal)));
  }, [candidates, deal, isLoading, seeded]);

  const blocker = bundleBlocker(name, selected.size + 1);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    if (blocker) return;
    setSaving(true);
    try {
      const res = await fetch('/api/deal-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          deal_ids: [deal.id, ...selected],
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || 'Could not create the bundle');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deal-workspace'] }),
        queryClient.invalidateQueries({
          queryKey: ['transaction-workspace-index'],
        }),
        queryClient.invalidateQueries({ queryKey: ['deal-events'] }),
        queryClient.invalidateQueries({
          queryKey: ['deal-bundle-candidates'],
        }),
      ]);
      toast.success(`Bundled ${selected.size + 1} deals as ${name.trim()}.`);
      onDone();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not create the bundle'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-white">Bundle linked deals</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-3">
        <p className="text-xs text-slate-400">
          One buyer closing several properties together. Each deal keeps its own
          seller, milestones, papers and terms; the bundle shows their combined
          progress and lets a shared stakeholder see every deal they are on.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="bundle-name" className="text-slate-300">
            Bundle name
          </Label>
          <Input
            id="bundle-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-slate-700 bg-slate-950 text-white"
          />
        </div>
        <div className="grid gap-2">
          <Label className="text-slate-300">
            Deals to bundle with this one
          </Label>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading deals…
            </div>
          ) : candidates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
              No other open deal is free to bundle.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {candidates.map((c) => {
                const checked = selected.has(c.id);
                const sameBuyer =
                  Boolean(deal.contact_id) && c.contact_id === deal.contact_id;
                return (
                  <li key={c.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors',
                        checked
                          ? 'border-primary/50 bg-primary/10'
                          : 'border-slate-800 bg-slate-950/60 hover:border-slate-600'
                      )}
                    >
                      <input
                        type="checkbox"
                        className="accent-primary h-4 w-4"
                        checked={checked}
                        disabled={
                          !checked && selected.size + 1 >= BUNDLE_MAX_DEALS
                        }
                        onChange={() => toggle(c.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-white">
                          {bundleCandidateLabel(c)}
                        </span>
                        <span className="block truncate text-[11px] text-slate-400">
                          {[c.contact_name, c.stage_name]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      {sameBuyer && (
                        <span className="shrink-0 rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300">
                          Same buyer
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {blocker && <p className="text-[11px] text-slate-500">{blocker}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={Boolean(blocker) || saving}
          onClick={() => void create()}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Layers className="h-4 w-4" />
          )}
          Create bundle
        </Button>
      </DialogFooter>
    </>
  );
}

function BundleMembers({
  group,
  currentDealId,
}: {
  group: { id: string; name: string };
  currentDealId: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['deal-bundle', group.id],
    queryFn: async (): Promise<BundleDetail> => {
      const res = await fetch(`/api/deal-groups/${group.id}`);
      const body = (await res.json().catch(() => null)) as {
        data?: BundleDetail;
        error?: string;
      } | null;
      if (!res.ok || !body?.data) {
        throw new Error(body?.error || 'Could not load the bundle');
      }
      return body.data;
    },
  });

  const pct =
    data && data.progress.total > 0
      ? Math.round((data.progress.done / data.progress.total) * 100)
      : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-white">
          <Layers className="h-4 w-4" />
          {group.name}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading bundle…
          </div>
        ) : !data ? (
          <p className="text-xs text-slate-500">
            This bundle could not be loaded.
          </p>
        ) : (
          <>
            {pct !== null && (
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <span className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-800">
                  <span
                    className="block h-full rounded-full bg-emerald-500/70"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span>
                  {data.progress.done}/{data.progress.total} milestones across{' '}
                  {data.deals.length} deals
                </span>
              </div>
            )}
            <ul className="space-y-1">
              {data.deals.map((member) => {
                const contact = one(member.contact);
                const property = one(member.property);
                const stage = one(member.stage);
                const who = [contact?.name, contact?.second_name]
                  .filter(Boolean)
                  .join(' ');
                const label = bundleCandidateLabel({
                  title: member.title,
                  property_title: property?.title ?? null,
                  property_unit_no: property?.unit_no ?? null,
                });
                const current = member.id === currentDealId;
                const inner = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">
                        {who ? `${who} — ${label}` : label}
                        {current && (
                          <span className="ml-2 text-[10px] text-slate-500">
                            this deal
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {[
                          stage?.name,
                          `${member.progress.done}/${member.progress.total} milestones`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-white">
                      Rs. {formatIndianDigits(member.value ?? 0, 0)}
                    </span>
                  </>
                );
                return (
                  <li key={member.id}>
                    {current ? (
                      <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                        {inner}
                      </div>
                    ) : (
                      <Link
                        href={`/deals/${member.id}`}
                        className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 transition-colors hover:border-slate-600"
                      >
                        {inner}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
