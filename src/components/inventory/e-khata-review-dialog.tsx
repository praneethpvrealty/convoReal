'use client';

import { useState } from 'react';
import { FileCheck2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  EKhataChange,
  EKhataChangeKey,
} from '@/lib/inventory/e-khata-fields';

interface EKhataReviewDialogProps {
  open: boolean;
  changes: EKhataChange[];
  notes: string[];
  onApply: (keys: EKhataChangeKey[]) => void;
  onClose: () => void;
}

export function EKhataReviewDialog({
  open,
  changes,
  notes,
  onApply,
  onClose,
}: EKhataReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-slate-700 bg-slate-900 text-slate-200 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="text-primary size-4" /> Read from the e-Khata
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Tick what to copy into this listing. Values that would replace
            something you already entered start unticked.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ReviewBody
            changes={changes}
            notes={notes}
            onApply={onApply}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewBody({
  changes,
  notes,
  onApply,
  onClose,
}: Omit<EKhataReviewDialogProps, 'open'>) {
  const [selected, setSelected] = useState<Set<EKhataChangeKey>>(
    () => new Set(changes.filter((c) => !c.replaces).map((c) => c.key))
  );

  function toggle(key: EKhataChangeKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      {changes.length === 0 ? (
        <p className="text-sm text-slate-400">
          The listing already matches this e-Khata.
        </p>
      ) : (
        <div className="space-y-2">
          {changes.map((change) => (
            <label
              key={change.key}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5"
            >
              <input
                type="checkbox"
                checked={selected.has(change.key)}
                onChange={() => toggle(change.key)}
                className="mt-1 accent-[var(--primary)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] tracking-wide text-slate-500 uppercase">
                  {change.label}
                </span>
                <span className="block text-sm break-words text-white">
                  {change.value}
                </span>
                {change.replaces && (
                  <span className="block text-xs break-words text-amber-400">
                    Replaces {change.current}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <div className="space-y-1 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
          <p className="text-[11px] tracking-wide text-slate-500 uppercase">
            Also on the e-Khata
          </p>
          {notes.map((note) => (
            <p key={note} className="text-xs break-words text-slate-300">
              {note}
            </p>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          type="button"
          disabled={selected.size === 0}
          onClick={() => onApply([...selected])}
        >
          Apply {selected.size || ''}
        </Button>
      </div>
    </>
  );
}
