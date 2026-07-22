'use client';

import { useEffect, useState } from 'react';
import { Loader2, MapPin, Sparkles } from 'lucide-react';
import { showcaseImageUrl, SHOWCASE_IMAGE_WIDTHS } from '@/lib/showcase-image';
import type { Property } from '@/types';

interface SimilarPropertiesProps {
  accountId: string;
  currentProperty: Property;
  /** Switches the showcase modal to the clicked property (mirrors the
   *  main grid's card click behaviour). */
  onSelect: (property: Property) => void;
}

interface ScoredProperty extends Property {
  _similarity_score?: number;
  _match_reasons?: string[];
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

/** Human-readable match pill based on the scoring reasons from the API */
function matchBadge(reasons: string[]): { label: string; color: string } | null {
  if (reasons.includes('same_area') || reasons.includes('very_close')) {
    return { label: 'Same Area', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
  }
  if (reasons.includes('similar_location') || reasons.includes('nearby')) {
    return { label: 'Nearby', color: 'bg-sky-500/20 text-sky-400 border-sky-500/30' };
  }
  if (reasons.includes('similar_price') && reasons.includes('same_type')) {
    return { label: 'Great Match', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
  }
  if (reasons.includes('similar_price')) {
    return { label: 'Similar Budget', color: 'bg-violet-500/20 text-violet-400 border-violet-500/30' };
  }
  if (reasons.includes('same_type')) {
    return { label: 'Same Type', color: 'bg-slate-500/20 text-slate-400 border-slate-500/30' };
  }
  return null;
}

/**
 * Smart similar-properties section inside the property detail modal.
 * Uses multi-signal scoring (location, price, type, bedrooms, listing type,
 * geo-proximity) to surface the most relevant recommendations — turning
 * every property view into a browse-more growth loop.
 */
export function SimilarProperties({ accountId, currentProperty, onSelect }: SimilarPropertiesProps) {
  const [properties, setProperties] = useState<ScoredProperty[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProperties(null);

    async function load() {
      // Pass seed attributes as query params so the API can score without a second DB call
      const params = new URLSearchParams({
        account_id: accountId,
        property_id: currentProperty.id,
        type: currentProperty.type || '',
        listing_type: currentProperty.listing_type || '',
        price: String(currentProperty.price || 0),
        rent: String(currentProperty.rent_per_month || 0),
        bedrooms: String(currentProperty.bedrooms || 0),
        location: currentProperty.location || '',
        sublocality: currentProperty.sublocality || '',
        city: currentProperty.city || '',
        lat: String(currentProperty.latitude || 0),
        lon: String(currentProperty.longitude || 0),
      });

      try {
        const res = await fetch(`/api/public/properties/similar?${params.toString()}`);
        if (!res.ok) throw new Error('fetch failed');
        const json = (await res.json()) as { data?: ScoredProperty[] };
        if (!cancelled) setProperties(json.data ?? []);
      } catch {
        if (!cancelled) setProperties([]);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId, currentProperty.id, currentProperty.type, currentProperty.listing_type,
      currentProperty.price, currentProperty.rent_per_month, currentProperty.bedrooms,
      currentProperty.location, currentProperty.sublocality, currentProperty.city,
      currentProperty.latitude, currentProperty.longitude]);

  if (properties === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 py-4">
        <Loader2 className="size-3.5 animate-spin" /> Finding similar properties…
      </div>
    );
  }

  if (properties.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-850 bg-slate-950/60 p-3">
      <div className="flex items-center gap-1.5 mb-3">
        <Sparkles className="size-3.5 text-primary" />
        <h4 className="text-xs font-bold text-white uppercase tracking-wider">
          You may also like
        </h4>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {properties.map((p) => {
          const badge = matchBadge(p._match_reasons || []);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p)}
              className="text-left rounded-lg border border-slate-850 bg-slate-900 hover:border-primary hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 overflow-hidden group"
            >
              <div className="aspect-[4/3] bg-slate-800 relative overflow-hidden">
                {p.images?.[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={showcaseImageUrl(p.images[0], SHOWCASE_IMAGE_WIDTHS.card)}
                    alt={p.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = p.images[0];
                    }}
                  />
                )}
                {badge && (
                  <span className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold border backdrop-blur-sm ${badge.color}`}>
                    {badge.label}
                  </span>
                )}
              </div>
              <div className="p-2">
                <p className="text-[11px] font-semibold text-white truncate">{p.title}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <MapPin className="size-2.5 text-slate-500 shrink-0" />
                  <p className="text-[10px] text-slate-400 truncate">{p.location}</p>
                </div>
                <p className="text-[11px] font-bold text-primary mt-1">{priceLabel(p)}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
