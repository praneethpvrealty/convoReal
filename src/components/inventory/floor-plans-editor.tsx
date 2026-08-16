'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { Plus, Trash2, Upload, Loader2, LayoutPanelTop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { storagePublicUrl } from '@/lib/storage/url';

export interface FloorPlanDraft {
  floor: string;
  image: string;
  area_sqft: string;
  notes: string;
}

export const emptyFloorPlan: FloorPlanDraft = {
  floor: '',
  image: '',
  area_sqft: '',
  notes: '',
};

interface FloorPlansEditorProps {
  value: FloorPlanDraft[];
  onChange: (next: FloorPlanDraft[]) => void;
  /** Stores the chosen file and resolves to its bucket-relative path. */
  onUpload: (file: File) => Promise<string | null>;
  disabled?: boolean;
}

export function FloorPlansEditor({
  value,
  onChange,
  onUpload,
  disabled,
}: FloorPlansEditorProps) {
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const update = (idx: number, key: keyof FloorPlanDraft, v: string) =>
    onChange(value.map((p, i) => (i === idx ? { ...p, [key]: v } : p)));

  async function pick(idx: number, file: File | undefined) {
    if (!file) return;
    setBusyIdx(idx);
    try {
      const path = await onUpload(file);
      if (path) update(idx, 'image', path);
    } finally {
      setBusyIdx(null);
      const input = inputRefs.current[idx];
      if (input) input.value = '';
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
            <LayoutPanelTop className="size-3.5 text-slate-500" />
            Floor Plans
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            One plan per floor. Plans found in an uploaded brochure are pinned
            here automatically.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...value, { ...emptyFloorPlan }])}
          className="h-8 shrink-0 border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          <Plus className="mr-1 size-3.5" />
          Add Floor
        </Button>
      </div>

      {value.map((plan, idx) => (
        <div
          key={idx}
          className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
              Floor {idx + 1}
            </span>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== idx))}
              className="text-slate-500 transition-colors hover:text-rose-400"
              aria-label={`Remove floor ${idx + 1}`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          <div className="flex gap-3">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-md border border-slate-700 bg-slate-950">
              {plan.image ? (
                <Image
                  src={storagePublicUrl(plan.image)}
                  alt={plan.floor || `Floor ${idx + 1} plan`}
                  fill
                  sizes="80px"
                  className="object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-slate-600">
                  <LayoutPanelTop className="size-6" />
                </div>
              )}
            </div>

            <div className="flex-1 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-400">Floor</Label>
                  <Input
                    value={plan.floor}
                    onChange={(e) => update(idx, 'floor', e.target.value)}
                    placeholder="e.g. Ground Floor"
                    className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-400">
                    Area (Sq.Ft.)
                  </Label>
                  <Input
                    type="number"
                    value={plan.area_sqft}
                    onChange={(e) => update(idx, 'area_sqft', e.target.value)}
                    placeholder="2400"
                    className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Input
                  value={plan.notes}
                  onChange={(e) => update(idx, 'notes', e.target.value)}
                  placeholder="e.g. 3 BHK + pooja room"
                  className="h-8 border-slate-700 bg-slate-800 text-xs text-white placeholder:text-slate-500"
                />
                <input
                  ref={(el) => {
                    inputRefs.current[idx] = el;
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => pick(idx, e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || busyIdx === idx}
                  onClick={() => inputRefs.current[idx]?.click()}
                  className="h-8 shrink-0 border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  {busyIdx === idx ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Upload className="size-3.5" />
                  )}
                  <span className="ml-1">
                    {plan.image ? 'Replace' : 'Plan'}
                  </span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {value.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-[11px] text-slate-500">
          No floor plans yet.
        </p>
      )}
    </div>
  );
}
