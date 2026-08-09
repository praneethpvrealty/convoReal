'use client';

// Create or edit a project — the facts every unit in it shares.
//
// Deliberately short. Anything that differs between units (price,
// area, BHK, owner, photos of that flat) belongs on the unit's own
// listing, and putting it here would invite an agent to fill it in
// once and have it be wrong for eleven of twelve flats.

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { availableProjectSlug } from '@/lib/inventory/projects';
import type { Project } from '@/types';

interface ProjectForm {
  name: string;
  builder: string;
  sublocality: string;
  city: string;
  possession_date: string;
  total_units: string;
  total_floors: string;
  description: string;
}

const BLANK: ProjectForm = {
  name: '',
  builder: '',
  sublocality: '',
  city: '',
  possession_date: '',
  total_units: '',
  total_floors: '',
  description: '',
};

function toForm(project: Project | null): ProjectForm {
  if (!project) return BLANK;
  return {
    name: project.name ?? '',
    builder: project.builder ?? '',
    sublocality: project.sublocality ?? '',
    city: project.city ?? '',
    possession_date: project.possession_date ?? '',
    total_units: project.total_units != null ? String(project.total_units) : '',
    total_floors: project.total_floors != null ? String(project.total_floors) : '',
    description: project.description ?? '',
  };
}

/** Blank stays null rather than 0 — "not recorded" and "zero floors"
 *  are different claims, and 0 would print as a fact. */
function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null creates; a row edits it. */
  project: Project | null;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const [form, setForm] = useState<ProjectForm>(BLANK);
  const [saving, setSaving] = useState(false);

  // Reseed on open so a create never inherits the last edit's values.
  useEffect(() => {
    if (open) setForm(toForm(project));
  }, [open, project]);

  const set = <K extends keyof ProjectForm>(key: K, value: ProjectForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name || !accountId) {
      toast.error('A project needs a name.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name,
        builder: form.builder.trim() || null,
        sublocality: form.sublocality.trim() || null,
        city: form.city.trim() || null,
        possession_date: form.possession_date || null,
        total_units: toNumberOrNull(form.total_units),
        total_floors: toNumberOrNull(form.total_floors),
        description: form.description.trim() || null,
      };

      if (project) {
        // The slug is deliberately left alone on rename: a link already
        // shared has to keep resolving, and the units' project name
        // follows the new name through a trigger either way.
        const { data, error } = await supabase
          .from('projects')
          .update(payload)
          .eq('id', project.id)
          .eq('account_id', accountId)
          .select('id');
        if (error) throw error;
        if (!data?.length) {
          toast.error('That project could not be saved.');
          return;
        }
        toast.success('Project updated');
      } else {
        const slug = await availableProjectSlug(supabase, accountId, name);
        const { error } = await supabase.from('projects').insert({
          ...payload,
          account_id: accountId,
          slug,
          created_by: user?.id ?? null,
        });
        if (error) throw error;
        toast.success(`${name} created — add its units next.`);
      }

      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error('Project save failed:', err);
      toast.error(err instanceof Error ? err.message : 'Could not save the project');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            {project ? 'Edit project' : 'New project'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Only what every unit shares. Price, area, BHK and owner stay on each
            unit&apos;s own listing.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name" className="text-slate-350 font-medium">
              Project name
            </Label>
            <Input
              id="project-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Sattva Exotic"
              required
              className="border-slate-800 bg-slate-950 text-white"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="project-builder" className="text-slate-350 font-medium">
                Builder
              </Label>
              <Input
                id="project-builder"
                value={form.builder}
                onChange={(e) => set('builder', e.target.value)}
                placeholder="Optional"
                className="border-slate-800 bg-slate-950 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-possession" className="text-slate-350 font-medium">
                Possession
              </Label>
              <Input
                id="project-possession"
                type="date"
                value={form.possession_date}
                onChange={(e) => set('possession_date', e.target.value)}
                className="border-slate-800 bg-slate-950 text-white"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="project-locality" className="text-slate-350 font-medium">
                Locality
              </Label>
              <Input
                id="project-locality"
                value={form.sublocality}
                onChange={(e) => set('sublocality', e.target.value)}
                placeholder="e.g. Hoodi"
                className="border-slate-800 bg-slate-950 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-city" className="text-slate-350 font-medium">
                City
              </Label>
              <Input
                id="project-city"
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                placeholder="e.g. Bangalore"
                className="border-slate-800 bg-slate-950 text-white"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="project-units" className="text-slate-350 font-medium">
                Total units
              </Label>
              <Input
                id="project-units"
                type="number"
                min={1}
                value={form.total_units}
                onChange={(e) => set('total_units', e.target.value)}
                placeholder="As built"
                className="border-slate-800 bg-slate-950 text-white"
              />
              <p className="text-[11px] text-slate-500">
                What the development has — not how many you hold, which is
                counted from the units you attach.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-floors" className="text-slate-350 font-medium">
                Total floors
              </Label>
              <Input
                id="project-floors"
                type="number"
                min={1}
                value={form.total_floors}
                onChange={(e) => set('total_floors', e.target.value)}
                placeholder="Optional"
                className="border-slate-800 bg-slate-950 text-white"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-description" className="text-slate-350 font-medium">
              About the project
            </Label>
            <Textarea
              id="project-description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              placeholder="Amenities, connectivity, approvals — anything true of every unit."
              className="border-slate-800 bg-slate-950 text-white"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="cursor-pointer text-slate-400"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !form.name.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary-hover cursor-pointer"
            >
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {project ? 'Save' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
