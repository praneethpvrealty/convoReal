'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

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
import {
  CONVERSATION_CLOSE_NOTE_MAX_LENGTH,
  CONVERSATION_CLOSE_REASONS,
  type ConversationCloseReason,
} from '@/lib/conversations/closure';
import { cn } from '@/lib/utils';

export function ConversationCloseDialog({
  open,
  contactName,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  contactName: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: ConversationCloseReason, note: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<ConversationCloseReason>(
    CONVERSATION_CLOSE_REASONS[0].value
  );
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.resolve().then(() => {
      setReason(CONVERSATION_CLOSE_REASONS[0].value);
      setNote('');
      setSaving(false);
    });
  }, [open]);

  const noteRequired = reason === 'other';
  const canSubmit = !saving && (!noteRequired || Boolean(note.trim()));

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit(reason, note);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-950 text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Close {contactName}&apos;s lead</DialogTitle>
          <DialogDescription>
            Choose the clearest reason. It stays searchable in the Closed inbox,
            and a new customer reply will reopen the chat.
          </DialogDescription>
        </DialogHeader>

        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            Reason
          </p>
          <div className="flex flex-wrap gap-2">
            {CONVERSATION_CLOSE_REASONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setReason(option.value)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition-colors',
                  reason === option.value
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-slate-700 text-slate-400 hover:text-slate-200'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              Note {noteRequired ? '(required)' : '(optional)'}
            </p>
            <span className="text-[11px] text-slate-500">
              {note.length}/{CONVERSATION_CLOSE_NOTE_MAX_LENGTH}
            </span>
          </div>
          <Textarea
            value={note}
            maxLength={CONVERSATION_CLOSE_NOTE_MAX_LENGTH}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add context for the team"
            className="min-h-24 border-slate-700 bg-slate-900 text-sm"
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
          <Button disabled={!canSubmit} onClick={submit}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Close lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
