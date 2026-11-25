'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Loader2, Phone, PhoneCall, Plus } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScheduleDialog } from '@/components/calendar/schedule-dialog';
import {
  LogCallPrompt,
  type PendingDial,
} from '@/components/contacts/log-call-prompt';
import {
  CALL_BACKS_QUERY_KEY,
  CALL_BACK_DEFAULT_TITLE,
  CALL_BACK_EVENT_TYPE,
  callBackBucket,
  groupCallBacks,
  type CallBackBucket,
} from '@/lib/calendar/call-backs';
import { cn } from '@/lib/utils';

interface CallBack {
  id: string;
  title: string;
  start_time: string;
  agenda?: string | null;
  contact?: { id: string; name?: string | null; phone?: string | null } | null;
}

interface CallBacksPanelProps {
  canEdit: boolean;
  onOpenEvent: (id: string) => void;
  onChanged: () => void;
}

async function fetchCallBacks(): Promise<CallBack[]> {
  const res = await fetch('/api/appointments/call-backs');
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || 'Failed to load call backs');
  return body?.data ?? [];
}

const BUCKET_TEXT: Record<CallBackBucket, string> = {
  overdue: 'text-red-400',
  today: 'text-amber-400',
  upcoming: 'text-slate-400',
};

function callTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function CallBacksPanel({
  canEdit,
  onOpenEvent,
  onChanged,
}: CallBacksPanelProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDial, setPendingDial] = useState<
    (PendingDial & { callBackId: string }) | null
  >(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: CALL_BACKS_QUERY_KEY,
    queryFn: fetchCallBacks,
    enabled: canEdit,
  });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const callBacks = useMemo(() => data ?? [], [data]);
  const groups = useMemo(
    () => groupCallBacks(callBacks, now),
    [callBacks, now]
  );
  const due = callBacks.filter(
    (c) => callBackBucket(c.start_time, now) !== 'upcoming'
  ).length;

  async function markDone(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Failed to mark it done');
      queryClient.setQueryData<CallBack[]>(CALL_BACKS_QUERY_KEY, (current) =>
        current?.filter((c) => c.id !== id)
      );
      onChanged();
      toast.success('Call back done');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark done');
    } finally {
      setBusyId(null);
    }
  }

  if (!canEdit) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
          due > 0
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'hover:bg-slate-850 border-slate-800 bg-slate-950 text-slate-300 hover:text-white'
        )}
      >
        <PhoneCall className="h-3.5 w-3.5" />
        Call backs{callBacks.length ? ` (${callBacks.length})` : ''}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-white">
              <PhoneCall className="text-primary size-4" />
              Call backs
            </SheetTitle>
            <SheetDescription className="text-xs text-slate-400">
              Your scheduled calls, overdue first. Call one and log it Connected
              to tick it off.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 px-4 pb-6">
            {canEdit && (
              <button
                type="button"
                onClick={() => setScheduleOpen(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"
              >
                <Plus className="size-3.5" />
                Schedule a call
              </button>
            )}

            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="size-5 animate-spin text-slate-500" />
              </div>
            ) : isError ? (
              <div className="py-10 text-center text-sm text-slate-400">
                Couldn’t load call backs.{' '}
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="text-primary font-semibold"
                >
                  Retry
                </button>
              </div>
            ) : groups.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">
                No call backs. Schedule a call from a contact’s phone number or
                the button above.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.bucket} className="space-y-2">
                  <p
                    className={cn(
                      'text-[11px] font-semibold tracking-wider uppercase',
                      BUCKET_TEXT[group.bucket]
                    )}
                  >
                    {group.label} ({group.items.length})
                  </p>
                  {group.items.map((item) => {
                    const name =
                      item.contact?.name || item.contact?.phone || item.title;
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            onOpenEvent(item.id);
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm font-semibold text-white">
                            {name}
                          </p>
                          <p
                            className={cn(
                              'text-xs font-medium',
                              BUCKET_TEXT[group.bucket]
                            )}
                          >
                            {callTime(item.start_time)}
                          </p>
                          {(item.agenda || item.contact?.phone) && (
                            <p className="truncate text-xs text-slate-500">
                              {item.agenda || item.contact?.phone}
                            </p>
                          )}
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            title="Mark done"
                            aria-label={`Mark the call to ${name} done`}
                            disabled={busyId === item.id}
                            onClick={() => void markDone(item.id)}
                            className="inline-flex size-8 items-center justify-center rounded-full border border-slate-700 text-slate-400 hover:text-white disabled:opacity-50"
                          >
                            {busyId === item.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4" />
                            )}
                          </button>
                        )}
                        {canEdit && item.contact?.phone && (
                          <a
                            href={`tel:${item.contact.phone}`}
                            title={`Call ${item.contact.phone}`}
                            aria-label={`Call ${name}`}
                            onClick={() =>
                              setPendingDial({
                                callBackId: item.id,
                                contactId: item.contact!.id,
                                name: item.contact!.name,
                                phone: item.contact!.phone ?? '',
                                dialedAt: new Date().toISOString(),
                              })
                            }
                            className="bg-primary text-primary-foreground inline-flex size-8 items-center justify-center rounded-full"
                          >
                            <Phone className="size-4" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      <LogCallPrompt
        dial={pendingDial}
        onOpenChange={(next) => {
          if (!next) setPendingDial(null);
        }}
        onLogged={(_contactId, _calledAt, outcome) => {
          const id = pendingDial?.callBackId;
          if (outcome === 'connected' && id) void markDone(id);
        }}
      />

      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        eventType={CALL_BACK_EVENT_TYPE}
        initialTitle={CALL_BACK_DEFAULT_TITLE}
        onSuccess={() => {
          void queryClient.invalidateQueries({
            queryKey: CALL_BACKS_QUERY_KEY,
          });
          onChanged();
        }}
      />
    </>
  );
}
