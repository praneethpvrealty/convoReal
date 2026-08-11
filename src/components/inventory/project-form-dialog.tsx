'use client';

// Create or edit a project — the facts every unit in it shares.
//
// Deliberately short. Anything that differs between units (price,
// area, BHK, owner, photos of that flat) belongs on the unit's own
// listing, and putting it here would invite an agent to fill it in
// once and have it be wrong for eleven of twelve flats.

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Trash2, Upload, X } from 'lucide-react';
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
import { storagePublicUrl } from '@/lib/storage/url';
import type { Project } from '@/types';

/** Same client-side downscale property photos get, duplicated rather
 *  than imported — property-form.tsx keeps its own private copy too,
 *  there's no shared export to reuse. */
function compressImageOnClient(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxW = 1200;
      let w = img.width;
      let h = img.height;

      if (w > maxW) {
        h = Math.round(h * (maxW / w));
        w = maxW;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Compression failed')), 'image/jpeg', 0.75);
    };

    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

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
  const [amenities, setAmenities] = useState<string[]>([]);
  const [amenityInput, setAmenityInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reseed on open so a create never inherits the last edit's values.
  useEffect(() => {
    if (open) {
      setForm(toForm(project));
      setAmenities(project?.amenities ?? []);
      setImages(project?.images ?? []);
      setAmenityInput('');
    }
  }, [open, project]);

  const set = <K extends keyof ProjectForm>(key: K, value: ProjectForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function addAmenity() {
    const value = amenityInput.trim();
    if (!value) return;
    setAmenities((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setAmenityInput('');
  }

  function removeAmenity(value: string) {
    setAmenities((prev) => prev.filter((a) => a !== value));
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onUploadImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!accountId) {
      toast.error('Account not loaded, please try again.');
      return;
    }

    setUploadingImage(true);
    const uploaded: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (file.size > 5 * 1024 * 1024) {
          toast.error(`File "${file.name}" is too large. Max size is 5MB.`);
          continue;
        }

        let uploadFile: File | Blob = file;
        if (file.type.startsWith('image/') && file.type !== 'image/svg+xml' && file.type !== 'image/gif') {
          try {
            uploadFile = await compressImageOnClient(file);
          } catch {
            // Fallback to original if compression fails
          }
        }

        const randomStr = Math.random().toString(36).substring(2, 7);
        // Same bucket property photos live in — a project gallery is
        // photos of the same building, not a separate media type.
        const path = `${accountId}/img-${Date.now()}-${randomStr}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('property-images')
          .upload(path, uploadFile, {
            cacheControl: '3600',
            upsert: true,
            contentType: 'image/jpeg',
          });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        uploaded.push(`property-images/${path}`);
      }

      if (uploaded.length > 0) {
        setImages((prev) => [...prev, ...uploaded]);
        toast.success(`Uploaded ${uploaded.length} image(s)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image upload failed';
      toast.error(message);
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

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
        amenities,
        images,
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
              placeholder="Connectivity, approvals, anything true of every unit."
              className="border-slate-800 bg-slate-950 text-white"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-amenities" className="text-slate-350 font-medium">
              Amenities
            </Label>
            {amenities.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {amenities.map((amenity) => (
                  <span
                    key={amenity}
                    className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-slate-750 bg-slate-800/60 text-slate-300 font-medium"
                  >
                    {amenity}
                    <button
                      type="button"
                      onClick={() => removeAmenity(amenity)}
                      className="text-slate-500 hover:text-red-400 cursor-pointer"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Input
              id="project-amenities"
              value={amenityInput}
              onChange={(e) => setAmenityInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addAmenity();
                }
              }}
              onBlur={addAmenity}
              placeholder="Type an amenity, press Enter — e.g. Swimming Pool"
              className="border-slate-800 bg-slate-950 text-white"
            />
          </div>

          <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/20 p-4">
            <div className="flex items-center justify-between">
              <Label className="text-slate-350 font-medium">Photos</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="h-7 cursor-pointer gap-1 text-xs font-semibold text-primary hover:bg-primary/10"
              >
                {uploadingImage ? (
                  <>
                    <Loader2 className="size-3 animate-spin" /> Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="size-3" /> Upload
                  </>
                )}
              </Button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={onUploadImages}
                multiple
                accept="image/*"
                className="hidden"
              />
            </div>
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((img, idx) => (
                  <div key={img} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={storagePublicUrl(img)}
                      alt={`Project photo ${idx + 1}`}
                      className="size-16 rounded border border-slate-700 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="absolute -right-1.5 -top-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
