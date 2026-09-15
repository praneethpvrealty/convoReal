'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, PauseCircle, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  CLOSED_JOURNEY_STATUS_META,
  JOURNEY_CLOSURE_REASONS,
  type ClosedJourneyStatus,
} from '@/lib/journey/overview-state';

const OUTCOMES: Array<{
  status: ClosedJourneyStatus;
  icon: typeof CheckCircle2;
  selectedClass: string;
}> = [
  {
    status: 'completed',
    icon: CheckCircle2,
    selectedClass: 'border-emerald-500/60 bg-emerald-500/10',
  },
  {
    status: 'paused',
    icon: PauseCircle,
    selectedClass: 'border-amber-500/60 bg-amber-500/10',
  },
  {
    status: 'not_proceeding',
    icon: XCircle,
    selectedClass: 'border-slate-500/60 bg-slate-500/10',
  },
];

export function CloseJourneyDialog({
  open,
  journeyName,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  journeyName: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (status: ClosedJourneyStatus, reason: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<ClosedJourneyStatus>('completed');
  const [reason, setReason] = useState(JOURNEY_CLOSURE_REASONS.completed[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.resolve().then(() => {
      setStatus('completed');
      setReason(JOURNEY_CLOSURE_REASONS.completed[0]);
      setSaving(false);
    });
  }, [open]);

  const selectStatus = (next: ClosedJourneyStatus) => {
    setStatus(next);
    setReason(JOURNEY_CLOSURE_REASONS[next][0]);
  };

  const submit = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await onSubmit(status, reason.trim());
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-950 text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Close {journeyName}&apos;s journey</DialogTitle>
          <DialogDescription>
            Record the outcome without losing the properties, progress, notes,
            or timeline. You can reopen it later.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-3">
          {OUTCOMES.map(({ status: option, icon: Icon, selectedClass }) => {
            const meta = CLOSED_JOURNEY_STATUS_META[option];
            return (
              <button
                key={option}
                type="button"
                onClick={() => selectStatus(option)}
                className={cn(
                  'rounded-xl border p-3 text-left transition-colors',
                  status === option
                    ? selectedClass
                    : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                )}
              >
                <Icon className="mb-2 h-4 w-4 text-slate-300" />
                <span className="block text-xs font-semibold text-white">
                  {meta.label}
                </span>
                <span className="mt-1 block text-[11px] leading-4 text-slate-400">
                  {meta.description}
                </span>
              </button>
            );
          })}
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            Reason
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {JOURNEY_CLOSURE_REASONS[status].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setReason(option)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  reason === option
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-slate-700 text-slate-400 hover:text-slate-200'
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <Textarea
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Add the specific context for future reference"
            className="min-h-20 border-slate-700 bg-slate-900 text-sm"
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={saving || !reason.trim()} onClick={submit}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Close journey
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
