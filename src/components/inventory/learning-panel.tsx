'use client';

// ============================================================
// One queue for everything waiting on an agent's judgement.
//
// Two shapes, deliberately not flattened into one. A proposal carries
// a value the Engine can write, so it gets Save/Dismiss. Portal drift
// carries two numbers and no idea which is right — that is settled by
// a survey or a phone call — so it gets a link to the portal listing
// and nothing to tap. Giving drift a fake "accept" button would invite
// an agent to rubber-stamp a number nobody checked.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Check, ExternalLink, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface Proposal {
  kind: 'proposal';
  id: string;
  entity: 'property' | 'contact';
  entityLabel: string;
  fieldLabel: string;
  currentText: string;
  proposedText: string;
  evidence: string;
}

interface PortalDrift {
  kind: 'portal_drift';
  id: string;
  entityLabel: string;
  fieldLabel: string;
  oursText: string;
  theirsText: string;
  portalLabel: string;
  listingUrl: string | null;
}

type ConflictItem = Proposal | PortalDrift;

interface LearningPanelProps {
  /** Scopes the queue to one listing. Omit for the account-wide queue. */
  propertyId?: string;
  /** Lets a parent refresh the record it is rendering once a fact lands. */
  onApplied?: () => void;
}

export function LearningPanel({ propertyId, onApplied }: LearningPanelProps) {
  const [items, setItems] = useState<ConflictItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = propertyId ? `?property_id=${propertyId}` : '';
      const res = await fetch(`/api/learning/conflicts${qs}`);
      if (!res.ok) return;
      const json = await res.json();
      setItems(json.data ?? []);
    } catch {
      // A queue that fails to load is not worth interrupting the agent
      // over — the panel simply stays empty.
    } finally {
      setLoaded(true);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/learning/facts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to record your decision');
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success(action === 'approve' ? 'Record updated' : 'Dismissed');
      if (action === 'approve') onApplied?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  };

  if (!loaded || items.length === 0) return null;

  const proposals = items.filter((i): i is Proposal => i.kind === 'proposal');
  const drifts = items.filter((i): i is PortalDrift => i.kind === 'portal_drift');

  return (
    <div className="mb-4 space-y-4">
      {proposals.length > 0 && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary h-4 w-4" />
            <h4 className="text-sm font-semibold text-white">
              Learned from your chats
            </h4>
          </div>

          {proposals.map((p) => (
            <div
              key={p.id}
              className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
            >
              {!propertyId && (
                <p className="text-xs font-medium text-slate-300">
                  {p.entityLabel}
                </p>
              )}
              <p className="text-sm text-slate-400 italic">
                &ldquo;{p.evidence}&rdquo;
              </p>
              <p className="text-sm text-white">
                {p.fieldLabel}:{' '}
                <span className="text-slate-500 line-through">
                  {p.currentText}
                </span>{' '}
                <span className="font-semibold">{p.proposedText}</span>
              </p>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  disabled={busyId === p.id}
                  onClick={() => review(p.id, 'approve')}
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Save to record
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === p.id}
                  onClick={() => review(p.id, 'reject')}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {drifts.length > 0 && (
        <div className="space-y-3 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h4 className="text-sm font-semibold text-white">
              Portal listings disagree with this record
            </h4>
          </div>
          <p className="text-[11px] text-slate-400">
            Buyers compare both. Correct whichever side is wrong — the bot
            quotes this record.
          </p>

          {drifts.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
            >
              <div className="space-y-0.5">
                {!propertyId && (
                  <p className="text-xs font-medium text-slate-300">
                    {d.entityLabel}
                  </p>
                )}
                <p className="text-sm text-white">
                  {d.fieldLabel} — {d.portalLabel}:{' '}
                  <span className="font-semibold text-amber-300">
                    {d.theirsText}
                  </span>
                  <span className="text-slate-500"> · ours: </span>
                  <span className="font-semibold">{d.oursText}</span>
                </p>
              </div>
              {d.listingUrl && (
                <a
                  href={d.listingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-slate-400 transition-colors hover:text-white"
                  aria-label={`Open the ${d.portalLabel} listing`}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
