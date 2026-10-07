'use client';

import { useEffect, useState } from 'react';
import { Loader2, MapPin, Sparkles } from 'lucide-react';
import type { Property } from '@/types';
import { formatInrCompact } from '@/lib/format/currency';

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

function priceLabel(p: Property): string {
  if (p.listing_type === 'Rent') {
    return p.rent_per_month
      ? `${formatInrCompact(p.rent_per_month)}/mo`
      : 'Price on request';
  }
  return p.price ? formatInrCompact(p.price) : 'Price on request';
}

/** Human-readable match pill based on the scoring reasons from the API */
function matchBadge(
  reasons: string[]
): { label: string; color: string } | null {
  if (reasons.includes('same_area') || reasons.includes('very_close')) {
    return {
      label: 'Same Area',
      color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    };
  }
  if (reasons.includes('similar_location') || reasons.includes('nearby')) {
    return {
      label: 'Nearby',
      color: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
    };
  }
  if (reasons.includes('similar_price') && reasons.includes('same_type')) {
    return {
      label: 'Great Match',
      color: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    };
  }
  if (reasons.includes('similar_price')) {
    return {
      label: 'Similar Budget',
      color: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
    };
  }
  if (reasons.includes('same_type')) {
    return {
      label: 'Same Type',
      color: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    };
  }
  return null;
}

/**
 * Smart similar-properties section inside the property detail modal.
 * Uses multi-signal scoring (location, price, type, bedrooms, listing type,
 * geo-proximity) to surface the most relevant recommendations — turning
 * every property view into a browse-more growth loop.
 */
export function SimilarProperties({
  accountId,
  currentProperty,
  onSelect,
}: SimilarPropertiesProps) {
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
        const res = await fetch(
          `/api/public/properties/similar?${params.toString()}`
        );
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
  }, [
    accountId,
    currentProperty.id,
    currentProperty.type,
    currentProperty.listing_type,
    currentProperty.price,
    currentProperty.rent_per_month,
    currentProperty.bedrooms,
    currentProperty.location,
    currentProperty.sublocality,
    currentProperty.city,
    currentProperty.latitude,
    currentProperty.longitude,
  ]);

  if (properties === null) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
        <Loader2 className="size-3.5 animate-spin" /> Finding similar
        properties…
      </div>
    );
  }

  if (properties.length === 0) return null;

  return (
    <div className="border-slate-850 rounded-xl border bg-slate-950/60 p-3">
      <div className="mb-3 flex items-center gap-1.5">
        <Sparkles className="text-primary size-3.5" />
        <h4 className="text-xs font-bold tracking-wider text-white uppercase">
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
              className="border-slate-850 hover:border-primary hover:shadow-primary/5 group overflow-hidden rounded-lg border bg-slate-900 text-left transition-all duration-200 hover:shadow-lg"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-slate-800">
                {p.images?.[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.images[0]}
                    alt={p.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                )}
                {badge && (
                  <span
                    className={`absolute top-1.5 left-1.5 rounded border px-1.5 py-0.5 text-[9px] font-bold backdrop-blur-sm ${badge.color}`}
                  >
                    {badge.label}
                  </span>
                )}
              </div>
              <div className="p-2">
                <p className="truncate text-[11px] font-semibold text-white">
                  {p.title}
                </p>
                <div className="mt-0.5 flex items-center gap-1">
                  <MapPin className="size-2.5 shrink-0 text-slate-500" />
                  <p className="truncate text-[10px] text-slate-400">
                    {p.location}
                  </p>
                </div>
                <p className="text-primary mt-1 text-[11px] font-bold">
                  {priceLabel(p)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
