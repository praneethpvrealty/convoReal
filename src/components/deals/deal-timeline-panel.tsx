'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, Lock, MessageSquarePlus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DEAL_EVENT_LABELS, type DealEvent } from '@/lib/deals/events';

interface DealTimelinePanelProps {
  dealId: string;
  canEdit: boolean;
}

export function DealTimelinePanel({ dealId, canEdit }: DealTimelinePanelProps) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['deal-events', dealId],
    queryFn: async (): Promise<DealEvent[]> => {
      const response = await fetch(`/api/deals/${dealId}/events`);
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load the timeline');
      return json.data ?? [];
    },
  });

  async function addNote() {
    const text = note.trim();
    if (!text) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/deals/${dealId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: text, source: 'web' }),
      });
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not add the note');
      setNote('');
      await queryClient.invalidateQueries({
        queryKey: ['deal-events', dealId],
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not add the note'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Timeline</h3>
          <p className="text-xs text-slate-400">
            Every change to this transaction, in order. Entries cannot be edited
            or removed.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">
          <Lock className="h-3 w-3" />
          Immutable
        </span>
      </div>

      {canEdit && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
          <Textarea
            rows={2}
            placeholder="Add an internal note to the timeline…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="border-slate-700 bg-slate-950"
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              onClick={addNote}
              disabled={saving || !note.trim()}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquarePlus className="h-4 w-4" />
              )}
              Add note
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading timeline…
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          Nothing recorded yet.
        </div>
      ) : (
        <ol className="space-y-2">
          {events.map((ev) => {
            const noteText =
              ev.event_type === 'note_added' &&
              typeof ev.metadata?.note === 'string'
                ? ev.metadata.note
                : null;
            return (
              <li
                key={ev.id}
                className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium text-white">
                    {noteText ?? ev.title}
                  </p>
                  <span className="text-[11px] text-slate-500">
                    {formatDistanceToNow(new Date(ev.created_at), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {DEAL_EVENT_LABELS[ev.event_type] ?? ev.event_type}
                  {ev.actor_name ? ` · ${ev.actor_name}` : ''}
                  {ev.source !== 'web' ? ` · ${ev.source}` : ''}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
