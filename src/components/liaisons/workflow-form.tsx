'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import type { LiaisonWorkflow, LiaisonWorkflowStage } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowDown, ArrowUp, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';

/** Editable row: duration kept as string while typing. */
interface StageRow {
  name: string;
  authority: string;
  duration_days: string;
  description: string;
}

const EMPTY_ROW: StageRow = { name: '', authority: '', duration_days: '', description: '' };

/** One-tap starting point for the most-asked-about process. */
const KHATA_NAME_CHANGE_EXAMPLE: { service_name: string; stages: StageRow[] } = {
  service_name: 'Change name in the khata document',
  stages: [
    {
      name: 'Case login',
      authority: 'Case worker',
      duration_days: '3',
      description:
        'Your application and documents (sale deed, EC, tax paid receipt, Aadhaar) are logged in the BBMP system and a case number is issued.',
    },
    {
      name: 'ARO verification & approval',
      authority: 'ARO (Assistant Revenue Officer)',
      duration_days: '7',
      description:
        'The ARO verifies the documents and property records. On approval the case moves up.',
    },
    {
      name: 'JD review & transfer',
      authority: 'JD (Joint Director)',
      duration_days: '7',
      description:
        'The JD reviews the case and transfers it to the DC for final approval.',
    },
    {
      name: 'DC approval',
      authority: 'DC (Deputy Commissioner)',
      duration_days: '10',
      description: 'The DC gives the final approval for the name change.',
    },
    {
      name: 'Khata issued',
      authority: 'BBMP',
      duration_days: '3',
      description:
        'The khata extract and certificate are issued with the new name. We collect and hand them over to you.',
    },
  ],
};

function toRows(stages: LiaisonWorkflowStage[]): StageRow[] {
  return stages.map((s) => ({
    name: s.name,
    authority: s.authority ?? '',
    duration_days:
      s.duration_days !== null && s.duration_days !== undefined
        ? String(s.duration_days)
        : '',
    description: s.description ?? '',
  }));
}

interface WorkflowFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow?: LiaisonWorkflow | null;
  onSaved: () => void;
}

export function WorkflowForm({ open, onOpenChange, workflow, onSaved }: WorkflowFormProps) {
  const isEdit = !!workflow;

  const [serviceName, setServiceName] = useState('');
  const [description, setDescription] = useState('');
  const [stages, setStages] = useState<StageRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setServiceName(workflow?.service_name ?? '');
    setDescription(workflow?.description ?? '');
    setStages(workflow ? toRows(workflow.stages ?? []) : [{ ...EMPTY_ROW }]);
  }, [open, workflow]);

  const updateStage = (index: number, patch: Partial<StageRow>) => {
    setStages((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const moveStage = (index: number, delta: -1 | 1) => {
    setStages((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeStage = (index: number) => {
    setStages((prev) => prev.filter((_, i) => i !== index));
  };

  const loadExample = () => {
    if (!serviceName.trim()) setServiceName(KHATA_NAME_CHANGE_EXAMPLE.service_name);
    setStages(KHATA_NAME_CHANGE_EXAMPLE.stages.map((s) => ({ ...s })));
  };

  const handleSubmit = async () => {
    if (!serviceName.trim()) {
      toast.error('Service name is required');
      return;
    }
    const validStages = stages.filter((s) => s.name.trim());
    if (validStages.length === 0) {
      toast.error('Add at least one stage');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        service_name: serviceName.trim(),
        description: description.trim() || null,
        stages: validStages.map((s) => {
          const days = Number(s.duration_days);
          return {
            name: s.name.trim(),
            authority: s.authority.trim() || null,
            duration_days:
              s.duration_days.trim() && Number.isFinite(days) && days > 0
                ? Math.round(days)
                : null,
            description: s.description.trim() || null,
          };
        }),
      };

      const url = isEdit ? `/api/liaison-workflows/${workflow.id}` : '/api/liaison-workflows';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Request failed');
      }

      toast.success(isEdit ? 'Workflow updated' : 'Workflow created');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error('Error saving workflow:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save workflow');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isEdit ? 'Edit Workflow' : 'New Workflow'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Define the process stage by stage — who approves what and how long each
            step takes — then share it with clients on WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wf-service" className="text-xs text-slate-300">
              Process / Service <span className="text-red-400">*</span>
            </Label>
            <Input
              id="wf-service"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="e.g. Change name in the khata document"
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wf-description" className="text-xs text-slate-300">
              Intro for the client
            </Label>
            <Textarea
              id="wf-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional opening line, e.g. Here is how your khata name change will move through BBMP."
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-14 resize-none"
            />
          </div>

          <div className="space-y-2 border-t border-slate-800 pt-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-slate-300">Stages (in order)</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={loadExample}
                  className="h-7 text-xs border-slate-700 text-slate-300 hover:bg-slate-800 gap-1 cursor-pointer"
                >
                  <Sparkles className="size-3" />
                  Khata example
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setStages((prev) => [...prev, { ...EMPTY_ROW }])}
                  className="h-7 text-xs border-slate-700 text-slate-300 hover:bg-slate-800 gap-1 cursor-pointer"
                >
                  <Plus className="size-3" />
                  Add stage
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {stages.map((row, index) => (
                <div
                  key={index}
                  className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {index + 1}
                    </span>
                    <Input
                      value={row.name}
                      onChange={(e) => updateStage(index, { name: e.target.value })}
                      placeholder="Stage, e.g. ARO verification & approval"
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => moveStage(index, -1)}
                      disabled={index === 0}
                      aria-label="Move stage up"
                      className="text-slate-500 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default"
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStage(index, 1)}
                      disabled={index === stages.length - 1}
                      aria-label="Move stage down"
                      className="text-slate-500 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default"
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removeStage(index)}
                      aria-label="Remove stage"
                      className="h-8 w-8 p-0 text-slate-500 hover:text-red-400 hover:bg-slate-800 cursor-pointer shrink-0"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-[1fr_8rem] gap-2">
                    <Input
                      value={row.authority}
                      onChange={(e) => updateStage(index, { authority: e.target.value })}
                      placeholder="Authority, e.g. ARO"
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs"
                    />
                    <Input
                      value={row.duration_days}
                      onChange={(e) =>
                        updateStage(index, {
                          duration_days: e.target.value.replace(/[^\d]/g, ''),
                        })
                      }
                      placeholder="Days"
                      inputMode="numeric"
                      className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs"
                    />
                  </div>
                  <Input
                    value={row.description}
                    onChange={(e) => updateStage(index, { description: e.target.value })}
                    placeholder="What happens here (shown to the client)"
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="bg-slate-900 border-slate-700">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? 'Save changes' : 'Create workflow'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
