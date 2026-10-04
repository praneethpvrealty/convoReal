'use client';

// The Projects tab: a multi-unit development and the listings inside
// it. A project holds what every unit shares — one map pin, one
// brochure, one set of amenities — so a tower of flats stops being N
// listings that each retyped the same facts.
//
// Nothing here shows a stored price. The "from" figures come from
// project_unit_stats, recomputed on every load, so the floor rises by
// itself the day the cheapest unit sells.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Loader2, MapPin, Pencil, Plus, Layers } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { listProjects, type ProjectWithStats } from '@/lib/inventory/projects';
import {
  projectAvailabilityLine,
  projectBhkRange,
  projectPriceHeadline,
  projectRateHeadline,
  projectSoldPercent,
} from '@/lib/inventory/project-pricing';
import { ProjectFormDialog } from '@/components/inventory/project-form-dialog';
import { ProjectUnitsDialog } from '@/components/inventory/project-units-dialog';
import type { Project } from '@/types';

export function ProjectCard({
  project,
  onEdit,
  onManageUnits,
}: {
  project: ProjectWithStats;
  onEdit: () => void;
  onManageUnits: () => void;
}) {
  const where = [project.sublocality, project.city].filter(Boolean).join(', ');
  const rate = projectRateHeadline(project.stats);
  const bhk = projectBhkRange(project.stats);
  const soldPercent = projectSoldPercent(project.stats);

  return (
    <div
      data-testid="project-card"
      className="group relative flex flex-col rounded-xl border border-slate-800 bg-slate-900/50 p-4 backdrop-blur-sm transition-colors focus-within:border-slate-600 hover:border-slate-600"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-white">
            <button
              type="button"
              onClick={onManageUnits}
              aria-label={`Open units of ${project.name}`}
              className="cursor-pointer text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none"
            >
              {project.name}
            </button>
          </h3>
          {where && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{where}</span>
            </p>
          )}
        </div>
        {project.builder && (
          <span className="shrink-0 rounded border border-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
            {project.builder}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-bold text-white">
          {projectPriceHeadline(project.stats)}
        </span>
        {/* The line the agent asked for. Empty when no available unit
            has both a price and an area, rather than showing ₹0. */}
        {rate && <span className="text-primary text-sm">{rate}</span>}
        {bhk && <span className="text-xs text-slate-400">{bhk}</span>}
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-300">
            {projectAvailabilityLine(project.stats)}
          </span>
          {project.stats.units > 0 && (
            <span className="text-slate-400">{soldPercent}%</span>
          )}
        </div>
        {project.stats.units > 0 && (
          <div
            role="progressbar"
            aria-label="Units sold"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={soldPercent}
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800"
          >
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${soldPercent}%` }}
            />
          </div>
        )}
      </div>

      <div className="pointer-events-none relative z-10 mt-auto flex gap-2 pt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={onManageUnits}
          className="pointer-events-auto h-8 cursor-pointer border-slate-700 bg-slate-800 text-xs font-semibold text-slate-100 hover:bg-slate-700"
        >
          <Layers className="mr-1 size-3.5" />
          Manage units
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          className="pointer-events-auto h-8 cursor-pointer border-slate-700 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <Pencil className="mr-1 size-3.5" />
          Edit
        </Button>
      </div>
    </div>
  );
}

export default function ProjectsContent() {
  const supabase = useMemo(() => createClient(), []);
  const { accountId } = useAuth();

  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [unitsFor, setUnitsFor] = useState<Project | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      setProjects(await listProjects(supabase, accountId));
    } catch (err) {
      console.error('Failed to load projects:', err);
      toast.error('Could not load projects');
    } finally {
      setLoading(false);
    }
  }, [supabase, accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          Group flats in one tower or development. Shared details are stored
          once; each unit stays its own listing with its own price and owner.
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="bg-primary text-primary-foreground hover:bg-primary-hover shrink-0 cursor-pointer"
        >
          <Plus className="mr-1 size-4" />
          New project
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center">
          <Building2 className="mx-auto size-8 text-slate-700" />
          <p className="mt-3 text-sm font-medium text-slate-300">
            No projects yet
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Create one for a tower or development, then attach the listings that
            belong to it. Units can have different owners and different prices.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onEdit={() => {
                setEditing(p);
                setFormOpen(true);
              }}
              onManageUnits={() => setUnitsFor(p)}
            />
          ))}
        </div>
      )}

      <ProjectFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        project={editing}
        onSaved={load}
      />

      <ProjectUnitsDialog
        project={unitsFor}
        onOpenChange={(open) => {
          if (!open) setUnitsFor(null);
        }}
        onChanged={load}
      />
    </div>
  );
}
