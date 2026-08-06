'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, PhoneCall, PhoneMissed, PhoneOff } from 'lucide-react';
import type { CallOutcome } from '@/types';

/** Captured at the moment the tel: link is tapped, so the log carries
 *  the dial time even if the prompt is answered after a long call. */
export interface PendingDial {
  contactId: string;
  name?: string | null;
  phone: string;
  dialedAt: string;
}

/**
 * One-tap follow-up to a tel: dial. The browser gets no signal back
 * from the phone app, so the outcome has to come from the agent — this
 * asks for exactly that and nothing else; the full form (direction,
 * notes, recordings) stays in the contact's Calls tab.
 */
export function LogCallPrompt({
  dial,
  onOpenChange,
  onLogged,
}: {
  dial: PendingDial | null;
  onOpenChange: (open: boolean) => void;
  onLogged?: (contactId: string, calledAt: string) => void;
}) {
  const [saving, setSaving] = useState<CallOutcome | null>(null);
  const [durationMins, setDurationMins] = useState('');

  async function save(outcome: CallOutcome) {
    if (!dial || saving) return;
    setSaving(outcome);
    try {
      const mins = parseFloat(durationMins);
      const res = await fetch(`/api/contacts/${dial.contactId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: 'outbound',
          outcome,
          called_at: dial.dialedAt,
          duration_seconds:
            outcome === 'connected' && Number.isFinite(mins) && mins > 0
              ? Math.round(mins * 60)
              : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || 'Failed to log call');
      }
      toast.success('Call logged');
      onLogged?.(dial.contactId, dial.dialedAt);
      onOpenChange(false);
      setDurationMins('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log call');
    } finally {
      setSaving(null);
    }
  }

  const outcomes: { outcome: CallOutcome; label: string; icon: typeof PhoneCall; className: string }[] = [
    {
      outcome: 'connected',
      label: 'Connected',
      icon: PhoneCall,
      className: 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10',
    },
    {
      outcome: 'no_answer',
      label: 'No answer',
      icon: PhoneMissed,
      className: 'border-red-500/30 text-red-400 hover:bg-red-500/10',
    },
    {
      outcome: 'busy',
      label: 'Busy',
      icon: PhoneOff,
      className: 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10',
    },
  ];

  return (
    <Dialog open={dial !== null} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white text-base">Log this call?</DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            {dial?.name || dial?.phone} · How did the call go?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {outcomes.map(({ outcome, label, icon: Icon, className }) => (
              <button
                key={outcome}
                type="button"
                disabled={saving !== null}
                onClick={() => save(outcome)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border bg-slate-900/50 px-2 py-3 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 ${className}`}
              >
                {saving === outcome ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Icon className="size-4" />
                )}
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="0"
              placeholder="Duration (mins, optional)"
              value={durationMins}
              onChange={(e) => setDurationMins(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-slate-400 hover:text-white shrink-0"
            >
              Skip
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
