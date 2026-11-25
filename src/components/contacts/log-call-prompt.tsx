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
import { Textarea } from '@/components/ui/textarea';
import { ScheduleDialog } from '@/components/calendar/schedule-dialog';
import {
  CalendarPlus,
  Loader2,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { EventTypeValue } from '@/lib/calendar/event-type-defaults';
import { CALL_BACKS_QUERY_KEY } from '@/lib/calendar/call-backs';
import {
  CALL_FOLLOW_UP_EVENT_TYPE,
  SCHEDULED_CALL_EVENT_TYPE,
  callFollowUpTitle,
  callLogPayload,
  scheduledCallTitle,
  type QuickCallOutcome,
} from '@/lib/contacts/call-follow-up';

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
 * from the phone app, so the outcome has to come from the agent. A
 * connected call opens a second step for notes, duration and an
 * optional follow-up calendar event; the full form stays in the
 * contact's Calls tab.
 */
export function LogCallPrompt({
  dial,
  onOpenChange,
  onLogged,
}: {
  dial: PendingDial | null;
  onOpenChange: (open: boolean) => void;
  onLogged?: (
    contactId: string,
    calledAt: string,
    outcome: QuickCallOutcome
  ) => void;
}) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<QuickCallOutcome | 'schedule' | null>(
    null
  );
  const [connected, setConnected] = useState(false);
  const [durationMins, setDurationMins] = useState('');
  const [notes, setNotes] = useState('');
  const [schedule, setSchedule] = useState<{
    contactId: string;
    title: string;
    eventType: EventTypeValue;
  } | null>(null);

  function reset() {
    setConnected(false);
    setDurationMins('');
    setNotes('');
  }

  async function save(outcome: QuickCallOutcome, thenSchedule = false) {
    if (!dial || saving) return;
    setSaving(thenSchedule ? 'schedule' : outcome);
    try {
      const res = await fetch(`/api/contacts/${dial.contactId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          callLogPayload({
            outcome,
            calledAt: dial.dialedAt,
            notes,
            durationMins,
          })
        ),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || 'Failed to log call');
      }
      toast.success('Call logged');
      onLogged?.(dial.contactId, dial.dialedAt, outcome);
      if (thenSchedule) {
        setSchedule({
          contactId: dial.contactId,
          title: callFollowUpTitle(dial),
          eventType: CALL_FOLLOW_UP_EVENT_TYPE,
        });
      }
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log call');
    } finally {
      setSaving(null);
    }
  }

  function handleOpenChange(open: boolean) {
    if (open) return onOpenChange(true);
    if (connected) {
      void save('connected');
      return;
    }
    onOpenChange(false);
    reset();
  }

  const outcomes: {
    outcome: QuickCallOutcome;
    label: string;
    icon: typeof PhoneCall;
    className: string;
  }[] = [
    {
      outcome: 'connected',
      label: 'Connected',
      icon: PhoneCall,
      className:
        'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10',
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
    <>
      <Dialog open={dial !== null} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-sm border-slate-800 bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-base text-white">
              {connected ? 'Call connected' : 'Log this call?'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              {dial?.name || dial?.phone} ·{' '}
              {connected
                ? 'Add notes or plan the next step.'
                : 'How did the call go?'}
            </DialogDescription>
          </DialogHeader>

          {connected ? (
            <div className="space-y-3">
              <Textarea
                autoFocus
                rows={4}
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-500"
              />
              <Input
                type="number"
                min="0"
                placeholder="Duration (mins, optional)"
                value={durationMins}
                onChange={(e) => setDurationMins(e.target.value)}
                className="h-8 border-slate-700 bg-slate-800 text-sm text-white placeholder:text-slate-500"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving !== null}
                  onClick={() => save('connected', true)}
                  className="border-slate-700 text-slate-200"
                >
                  {saving === 'schedule' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CalendarPlus className="size-4" />
                  )}
                  Save & add event
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={saving !== null}
                  onClick={() => save('connected')}
                >
                  {saving === 'connected' && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {outcomes.map(({ outcome, label, icon: Icon, className }) => (
                  <button
                    key={outcome}
                    type="button"
                    disabled={saving !== null}
                    onClick={() =>
                      outcome === 'connected'
                        ? setConnected(true)
                        : save(outcome)
                    }
                    className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border bg-slate-900/50 px-2 py-3 text-xs font-semibold transition-all disabled:opacity-50 ${className}`}
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

              <div className="flex justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving !== null}
                  onClick={() => {
                    if (!dial) return;
                    setSchedule({
                      contactId: dial.contactId,
                      title: scheduledCallTitle(dial),
                      eventType: SCHEDULED_CALL_EVENT_TYPE,
                    });
                    handleOpenChange(false);
                  }}
                  className="text-slate-300 hover:text-white"
                >
                  <CalendarPlus className="size-4" />
                  Schedule call
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenChange(false)}
                  className="shrink-0 text-slate-400 hover:text-white"
                >
                  Skip
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ScheduleDialog
        open={schedule !== null}
        onOpenChange={(open) => {
          if (!open) setSchedule(null);
        }}
        contactId={schedule?.contactId ?? null}
        initialTitle={schedule?.title}
        eventType={schedule?.eventType}
        onSuccess={() =>
          queryClient.invalidateQueries({ queryKey: CALL_BACKS_QUERY_KEY })
        }
      />
    </>
  );
}
