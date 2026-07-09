'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { showcaseImageUrl, SHOWCASE_IMAGE_WIDTHS } from '@/lib/showcase-image';
import type { Property } from '@/types';

interface SimilarPropertiesProps {
  accountId: string;
  currentProperty: Property;
  /** Switches the showcase modal to the clicked property (mirrors the
   *  main grid's card click behaviour). */
  onSelect: (property: Property) => void;
}

function inr(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(n % 10000000 === 0 ? 0 : 2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function priceLabel(p: Property): string {
  if (p.listing_type === 'Rent') {
    return p.rent_per_month ? `${inr(p.rent_per_month)}/mo` : 'Price on request';
  }
  return p.price ? inr(p.price) : 'Price on request';
}

/**
 * Fetches up to 4 other published properties from the same agent that
 * resemble the one being viewed (same type, then progressively looser
 * price band if that yields too few results) and renders them as
 * compact clickable cards. Every showcase view becoming a browse-more
 * surface is the growth loop for the buyer funnel — a buyer who came
 * for one listing leaves having seen the agent's whole inventory.
 */
export function SimilarProperties({ accountId, currentProperty, onSelect }: SimilarPropertiesProps) {
  const [properties, setProperties] = useState<Property[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProperties(null);

    async function load() {
      const params = new URLSearchParams({
        account_id: accountId,
        type: currentProperty.type,
        limit: '5', // fetch one extra in case the current property is included
      });

      try {
        const res = await fetch(`/api/public/properties?${params.toString()}`);
        if (!res.ok) throw new Error('fetch failed');
        const json = (await res.json()) as { data?: Property[] };
        const results = (json.data ?? []).filter((p) => p.id !== currentProperty.id).slice(0, 4);
        if (!cancelled) setProperties(results);
      } catch {
        if (!cancelled) setProperties([]);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId, currentProperty.id, currentProperty.type]);

  if (properties === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 py-4">
        <Loader2 className="size-3.5 animate-spin" /> Loading similar properties…
      </div>
    );
  }

  if (properties.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-850 bg-slate-950/60 p-3">
      <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2">
        Similar properties from this agent
      </h4>
      <div className="grid grid-cols-2 gap-2">
        {properties.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p)}
            className="text-left rounded-lg border border-slate-850 bg-slate-900 hover:border-primary transition-colors overflow-hidden"
          >
            <div className="aspect-[4/3] bg-slate-800">
              {p.images?.[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={showcaseImageUrl(p.images[0], SHOWCASE_IMAGE_WIDTHS.thumb)}
                  alt={p.title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = p.images[0];
                  }}
                />
              )}
            </div>
            <div className="p-2">
              <p className="text-[11px] font-semibold text-white truncate">{p.title}</p>
              <p className="text-[10px] text-slate-400 truncate">{p.location}</p>
              <p className="text-[11px] font-bold text-primary mt-0.5">{priceLabel(p)}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
