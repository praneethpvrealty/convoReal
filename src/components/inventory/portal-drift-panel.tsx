'use client';

// ============================================================
// "MagicBricks says something else."
//
// Fields where this listing and its harvested portal copies disagree.
// Read-only on purpose: which figure is right is a question about the
// property — a survey, a revised quote — not something the Engine can
// settle by picking the newer row. The panel's job is to make the gap
// impossible to miss and link straight to the portal listing so the
// agent can fix whichever side is wrong.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';

const FIELD_LABELS: Record<string, string> = {
  price: 'Price',
  area_sqft: 'Area',
  bedrooms: 'Bedrooms',
};

interface Discrepancy {
  portal: string;
  portalLabel: string;
  listingUrl: string | null;
  field: string;
  ours: number;
  theirs: number;
}

function formatValue(field: string, value: number): string {
  if (field === 'price') return '₹' + value.toLocaleString('en-IN');
  if (field === 'area_sqft') return `${value.toLocaleString('en-IN')} sq.ft.`;
  return String(value);
}

export function PortalDriftPanel({ propertyId }: { propertyId: string }) {
  const [drifts, setDrifts] = useState<Discrepancy[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/properties/${propertyId}/portal-drift`);
      if (!res.ok) return;
      const json = await res.json();
      setDrifts(json.data ?? []);
    } catch {
      // A listing that has never been portal-synced is the common case;
      // failing to load is not worth interrupting the agent over.
    } finally {
      setLoaded(true);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded || drifts.length === 0) return null;

  return (
    <div className="mb-4 space-y-3 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <h4 className="text-sm font-semibold text-white">
          Portal listings disagree with this record
        </h4>
      </div>
      <p className="text-[11px] text-slate-400">
        Buyers compare both. Correct whichever side is wrong — the bot quotes
        this record.
      </p>

      <div className="space-y-2">
        {drifts.map((d) => (
          <div
            key={`${d.portal}-${d.field}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
          >
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-slate-300">
                {FIELD_LABELS[d.field] ?? d.field}
              </p>
              <p className="text-sm text-white">
                {d.portalLabel}:{' '}
                <span className="font-semibold text-amber-300">
                  {formatValue(d.field, d.theirs)}
                </span>
                <span className="text-slate-500"> · ours: </span>
                <span className="font-semibold">
                  {formatValue(d.field, d.ours)}
                </span>
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
    </div>
  );
}
