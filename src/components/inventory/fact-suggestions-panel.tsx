'use client';

// ============================================================
// "You told a buyer this — should the listing know it?"
//
// Facts extracted from an agent's own WhatsApp replies, waiting on a
// human. The card leads with the agent's sentence rather than the
// parsed number: what is being confirmed is that the sentence meant
// what the model read, and a reviewer can only judge that from the
// words. Approving is what writes the field (see the PATCH route);
// nothing here has touched the listing yet.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

const FIELD_LABELS: Record<string, string> = {
  seller_final_price: "Seller's final price",
  seller_final_price_per_sqft: "Seller's final rate (per Sq.Ft.)",
};

interface Suggestion {
  id: string;
  property_id: string;
  field: string;
  current_value: number | null;
  suggested_value: number;
  evidence: string;
  created_at: string;
  property?: { title: string; property_code: string | null } | null;
  contact?: { name: string | null; phone: string | null } | null;
}

function inr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

interface FactSuggestionsPanelProps {
  /** Scopes the queue to one listing. Omit for the account-wide queue. */
  propertyId?: string;
  /** Lets a parent refresh the listing it is rendering once a fact lands. */
  onApplied?: () => void;
}

export function FactSuggestionsPanel({
  propertyId,
  onApplied,
}: FactSuggestionsPanelProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = propertyId ? `?property_id=${propertyId}` : '';
      const res = await fetch(`/api/properties/fact-suggestions${qs}`);
      if (!res.ok) return;
      const json = await res.json();
      setSuggestions(json.data ?? []);
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
      const res = await fetch(`/api/properties/fact-suggestions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to record your decision');
      }
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
      toast.success(
        action === 'approve' ? 'Listing updated' : 'Suggestion dismissed'
      );
      if (action === 'approve') onApplied?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  };

  if (!loaded || suggestions.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="text-primary h-4 w-4" />
        <h4 className="text-sm font-semibold text-white">
          Learned from your chats
        </h4>
      </div>

      {suggestions.map((s) => (
        <div
          key={s.id}
          className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
        >
          {!propertyId && s.property && (
            <p className="text-xs font-medium text-slate-300">
              {s.property.title}
              {s.property.property_code ? ` · ${s.property.property_code}` : ''}
            </p>
          )}

          <p className="text-sm text-slate-400 italic">
            &ldquo;{s.evidence}&rdquo;
            {s.contact?.name ? (
              <span className="text-slate-500 not-italic">
                {' '}
                — to {s.contact.name}
              </span>
            ) : null}
          </p>

          <p className="text-sm text-white">
            {FIELD_LABELS[s.field] ?? s.field}:{' '}
            {s.current_value !== null && (
              <span className="text-slate-500 line-through">
                {inr(s.current_value)}
              </span>
            )}{' '}
            <span className="font-semibold">{inr(s.suggested_value)}</span>
          </p>

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              disabled={busyId === s.id}
              onClick={() => review(s.id, 'approve')}
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              Save to listing
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busyId === s.id}
              onClick={() => review(s.id, 'reject')}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
