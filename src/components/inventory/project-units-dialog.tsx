'use client';

// Which listings belong to this project.
//
// Attaching is the whole point: an agent who already created twelve
// flats one at a time should not have to recreate them. So this lists
// what the account holds, marks what is already in, and moves the
// selection in one write.
//
// A listing already attached to a DIFFERENT project is shown but not
// selectable — silently stealing a unit from another tower would be a
// worse surprise than being told why it is greyed.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { setUnitsProject } from '@/lib/inventory/projects';
import {
  formatRatePerSqft,
  unitRatePerSqft,
} from '@/lib/inventory/project-pricing';
import { formatShareAmount } from '@/lib/share-message-builder';
import type { Project, Property } from '@/types';

/** Enough of a listing to decide whether it is this project's unit. */
type UnitRow = Pick<
  Property,
  | 'id'
  | 'title'
  | 'price'
  | 'area_sqft'
  | 'bedrooms'
  | 'status'
  | 'unit_no'
  | 'tower'
  | 'floor_number'
  | 'project'
  | 'project_id'
>;

const PAGE_SIZE = 60;

export function ProjectUnitsDialog({
  project,
  onOpenChange,
  onChanged,
}: {
  project: Project | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { accountId } = useAuth();

  const [rows, setRows] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  /** Ids the agent wants attached when they hit Save. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** What was attached when the dialog opened, so Save writes the
   *  difference rather than rewriting every row. */
  const [initial, setInitial] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!project || !accountId) return;
    setLoading(true);
    try {
      let query = supabase
        .from('properties')
        .select(
          'id, title, price, area_sqft, bedrooms, status, unit_no, tower, floor_number, project, project_id',
        )
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      const term = search.trim();
      if (term) query = query.ilike('title', `%${term}%`);

      const { data, error } = await query;
      if (error) throw error;

      // Whatever the search returns, the project's own units are always
      // present — otherwise a filtered view would look like they had
      // been detached, and unticking one would detach it for real.
      const found = (data ?? []) as UnitRow[];
      const missingMine = term
        ? await supabase
            .from('properties')
            .select(
              'id, title, price, area_sqft, bedrooms, status, unit_no, tower, floor_number, project, project_id',
            )
            .eq('account_id', accountId)
            .eq('project_id', project.id)
            .then((r) => (r.data ?? []) as UnitRow[])
        : [];

      const byId = new Map<string, UnitRow>();
      for (const r of [...missingMine, ...found]) byId.set(r.id, r);
      const all = [...byId.values()];
      setRows(all);

      const mine = new Set(all.filter((r) => r.project_id === project.id).map((r) => r.id));
      setSelected(mine);
      setInitial(mine);
    } catch (err) {
      console.error('Failed to load units:', err);
      toast.error('Could not load listings');
    } finally {
      setLoading(false);
    }
  }, [supabase, accountId, project, search]);

  useEffect(() => {
    if (project) void load();
  }, [project, load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (!project || !accountId) return;
    const toAttach = [...selected].filter((id) => !initial.has(id));
    const toDetach = [...initial].filter((id) => !selected.has(id));
    if (toAttach.length === 0 && toDetach.length === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      const attached = await setUnitsProject(supabase, accountId, toAttach, project.id);
      const detached = await setUnitsProject(supabase, accountId, toDetach, null);

      // setUnitsProject returns rows actually moved: RLS refusing a
      // write comes back as zero, and reporting success on that would
      // be a lie the agent only discovers later.
      if (attached < toAttach.length || detached < toDetach.length) {
        toast.error('Some listings could not be moved — check your access.');
      } else {
        const parts = [];
        if (attached) parts.push(`${attached} added`);
        if (detached) parts.push(`${detached} removed`);
        toast.success(`${project.name}: ${parts.join(', ')}`);
      }
      onChanged();
      onOpenChange(false);
    } catch (err) {
      console.error('Unit attach failed:', err);
      toast.error(err instanceof Error ? err.message : 'Could not update units');
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    [...selected].some((id) => !initial.has(id)) ||
    [...initial].some((id) => !selected.has(id));

  return (
    <Dialog open={!!project} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] border-slate-800 bg-slate-900 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-white">
            Units in {project?.name}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Tick the listings that belong to this project. Each keeps its own
            price, owner and photos — only the shared details come from the
            project.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search listings by title"
            className="border-slate-800 bg-slate-950 pl-10 text-white"
          />
        </div>

        <div className="max-h-[45vh] space-y-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-slate-500" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              No listings found.
            </p>
          ) : (
            rows.map((row) => {
              const takenByAnother = !!row.project_id && row.project_id !== project?.id;
              const rate = formatRatePerSqft(
                unitRatePerSqft(row.price, row.area_sqft),
              );
              const label = [row.tower, row.unit_no].filter(Boolean).join(' ');
              return (
                <label
                  key={row.id}
                  className={`flex items-center gap-3 rounded-lg border border-slate-800/60 px-3 py-2 ${
                    takenByAnother
                      ? 'cursor-not-allowed opacity-50'
                      : 'cursor-pointer hover:bg-slate-800/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    disabled={takenByAnother}
                    onChange={() => toggle(row.id)}
                    className="size-4 shrink-0 accent-violet-500"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white">
                      {label && (
                        <span className="mr-1.5 font-mono text-xs text-primary">
                          {label}
                        </span>
                      )}
                      {row.title}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {[
                        formatShareAmount(row.price),
                        rate,
                        row.bedrooms ? `${row.bedrooms} BHK` : '',
                        row.status,
                        takenByAnother ? `In ${row.project}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </label>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer text-slate-400"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="bg-primary text-primary-foreground hover:bg-primary-hover cursor-pointer"
          >
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save units
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
