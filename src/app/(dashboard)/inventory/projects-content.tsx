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
import { Building2, Loader2, MapPin, Plus, Layers } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  listProjects,
  type ProjectWithStats,
} from '@/lib/inventory/projects';
import {
  projectAvailabilityLine,
  projectBhkRange,
  projectPriceHeadline,
  projectRateHeadline,
} from '@/lib/inventory/project-pricing';
import { ProjectFormDialog } from '@/components/inventory/project-form-dialog';
import { ProjectUnitsDialog } from '@/components/inventory/project-units-dialog';
import type { Project } from '@/types';

function ProjectCard({
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

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-white">{project.name}</h3>
          {where && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{where}</span>
            </p>
          )}
        </div>
        {project.builder && (
          <span className="shrink-0 rounded border border-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
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
        {rate && <span className="text-sm text-primary">{rate}</span>}
        {bhk && <span className="text-xs text-slate-400">{bhk}</span>}
      </div>

      <p className="mt-1 text-xs text-slate-500">
        {projectAvailabilityLine(project.stats)}
      </p>

      <div className="mt-3 flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onManageUnits}
          className="h-8 cursor-pointer border border-slate-800 text-xs text-slate-200 hover:bg-slate-800"
        >
          <Layers className="mr-1 size-3.5" />
          Units
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="h-8 cursor-pointer text-xs text-slate-400 hover:text-white"
        >
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
          <p className="mt-3 text-sm font-medium text-slate-300">No projects yet</p>
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
