'use client';

// Shortlist picker for one re-engaged lead: shows the properties Radar
// matched to their restated requirement, lets the agent narrow the
// selection, and sends the chosen ones over WhatsApp.
//
// The send goes through /api/radar/send, the same endpoint the Radar
// feed uses — it already resolves the channel per recipient (free-form
// inside the 24-hour window, approved template outside it) and marks
// the event sent. Duplicating that ladder here would drift from it.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Send, AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { MatchEventTarget } from '@/types';
import type { ReengagementLead } from '@/lib/reengagement/queries';
import { requirementSummary } from '@/lib/reengagement/funnel';

interface ShortlistDialogProps {
  lead: ReengagementLead | null;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}

export function ShortlistDialog({
  lead,
  onOpenChange,
  onSent,
}: ShortlistDialogProps) {
  const [matches, setMatches] = useState<MatchEventTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [templateMissing, setTemplateMissing] = useState(false);

  const eventId = lead?.matchEventId ?? null;

  const loadMatches = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setTemplateMissing(false);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('match_events')
        .select('matches')
        .eq('id', eventId)
        .maybeSingle();
      if (error) throw error;
      const rows = (data?.matches ?? []) as MatchEventTarget[];
      setMatches(rows);
      // Pre-select everything: the agent narrows down, which is faster
      // than building the shortlist up one tick at a time.
      setSelected(new Set(rows.map((m) => m.id)));
    } catch {
      toast.error('Failed to load matched properties');
      setMatches([]);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (eventId) loadMatches();
  }, [eventId, loadMatches]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSend() {
    if (!eventId || selected.size === 0) return;
    setSending(true);
    setTemplateMissing(false);
    try {
      const res = await fetch('/api/radar/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, targetIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');

      if (data.sent > 0) {
        toast.success(
          data.sentViaTemplate > 0
            ? `Shortlist sent — ${data.sent} propert${data.sent === 1 ? 'y' : 'ies'}, ${data.sentViaTemplate} via the approved template.`
            : `Shortlist sent — ${data.sent} propert${data.sent === 1 ? 'y' : 'ies'}.`
        );
        onSent();
        onOpenChange(false);
        return;
      }
      if (data.templateMissing > 0) {
        // Outside the 24h window with no approved property template —
        // say which, rather than a bare "failed".
        setTemplateMissing(true);
        return;
      }
      toast.error('Nothing was sent — please try again.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  const requirement = lead ? requirementSummary(lead) : '';

  return (
    <Dialog open={Boolean(lead)} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-900 text-slate-200 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            Shortlist for{' '}
            {lead?.contactName?.trim() || lead?.contactPhone || 'this lead'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {requirement
              ? `Looking for ${requirement}. Pick what to send.`
              : 'Pick the properties to send over WhatsApp.'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="text-primary size-5 animate-spin" />
          </div>
        ) : matches.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No matched properties on this lead yet.
          </p>
        ) : (
          <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {matches.map((match) => {
              const checked = selected.has(match.id);
              return (
                <div
                  key={match.id}
                  onClick={() => toggle(match.id)}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-all select-none ${
                    checked
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-slate-800 bg-slate-950/20'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {}}
                    className="text-primary mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-slate-700 bg-slate-800 focus:ring-0 focus:ring-offset-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-1">
                      <h5 className="truncate text-xs font-bold text-white">
                        {match.name}
                      </h5>
                      <span className="shrink-0 text-[10px] font-bold text-emerald-400">
                        {match.score}%
                      </span>
                    </div>
                    {match.detail && (
                      <p className="text-[10px] font-semibold text-slate-500">
                        {match.detail}
                      </p>
                    )}
                    {match.chips?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {match.chips.slice(0, 3).map((chip) => (
                          <span
                            key={chip}
                            className="rounded border border-slate-800 bg-slate-900 px-1 py-0.5 text-[9px] font-bold text-slate-400"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {templateMissing && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-600/50 bg-amber-950/30 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <p className="text-xs text-amber-200">
              This lead is outside the 24-hour window and the property-details
              template is not approved yet. Create it under Settings → WhatsApp
              Templates, then send again.
            </p>
          </div>
        )}

        <DialogFooter className="border-slate-700 bg-slate-900">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0 || sending || loading}
            onClick={handleSend}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send {selected.size > 0 ? selected.size : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
