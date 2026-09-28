'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  LOST_REASONS,
  lostReasonNeedsNote,
  type LostReason,
  type LostReasonInput,
} from '@/lib/pipelines/lost-reasons';

interface LostReasonDialogProps {
  dealTitle: string | null;
  onConfirm: (input: LostReasonInput) => void;
  onCancel: () => void;
}

export function LostReasonDialog({
  dealTitle,
  onConfirm,
  onCancel,
}: LostReasonDialogProps) {
  return (
    <Dialog open={dealTitle !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="border-slate-700 bg-slate-900 text-slate-200 sm:max-w-md">
        {dealTitle !== null ? (
          <LostReasonForm
            key={dealTitle}
            dealTitle={dealTitle}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LostReasonForm({
  dealTitle,
  onConfirm,
  onCancel,
}: {
  dealTitle: string;
  onConfirm: (input: LostReasonInput) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<LostReason | null>(null);
  const [note, setNote] = useState('');
  const noteMissing = lostReasonNeedsNote(reason) && !note.trim();

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-white">
          Why was this deal lost?
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <p className="text-xs text-slate-400">
          <span className="font-semibold text-slate-300">{dealTitle}</span>{' '}
          moves to Closed Lost. The reason stays on the deal and its journey.
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {LOST_REASONS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={reason === option}
              onClick={() => setReason(option)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                reason === option
                  ? 'border-red-400/60 bg-red-500/15 text-white'
                  : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="grid gap-2">
          <Label className="text-slate-300">
            {lostReasonNeedsNote(reason) ? 'What happened?' : 'Note (optional)'}
          </Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="e.g. Owner wants ₹20 L more than the buyer's ceiling"
            className="border-slate-700 bg-slate-800 text-sm text-white"
          />
        </div>
      </div>
      <DialogFooter className="border-slate-700 bg-slate-900/50">
        <Button
          variant="outline"
          onClick={onCancel}
          className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800"
        >
          Cancel
        </Button>
        <Button
          disabled={!reason || noteMissing}
          onClick={() =>
            reason &&
            onConfirm({ lost_reason: reason, lost_note: note.trim() || null })
          }
          className="bg-red-600 text-white hover:bg-red-700"
        >
          Mark lost
        </Button>
      </DialogFooter>
    </>
  );
}
