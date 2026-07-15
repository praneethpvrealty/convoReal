'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin, Loader2 } from 'lucide-react';
import { POPULAR_SUBLOCALITIES } from '@/lib/data/real-estate-data';

export const SUGGESTED_AREAS = ['Whitefield', 'Koramangala', 'Not specific', 'East Bangalore', 'Indiranagar', 'Jayanagar'];

interface GoogleSuggestion {
  place_id: string;
  main_text: string;
  secondary_text: string;
}

interface AreasOfInterestInputProps {
  areasText: string;
  areasOfInterest: string[];
  /** Fires with both the raw comma-separated text and the parsed area list. */
  onChange: (areasText: string, areasOfInterest: string[]) => void;
}

/**
 * Comma-separated multi-area input with three suggestion sources:
 * the curated sublocality dataset, Google Places Autocomplete (proxied
 * through /api/maps/* so the key stays server-side; degrades silently
 * when the proxy answers 501), and quick-add chips.
 */
export function AreasOfInterestInput({ areasText, areasOfInterest, onChange }: AreasOfInterestInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [localitiesDb, setLocalitiesDb] = useState<{ major: string[] } | null>(null);
  const [googleSuggestions, setGoogleSuggestions] = useState<GoogleSuggestion[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  // One Google billing session spans a typing burst; cleared after a pick.
  const sessionRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);
  const mapsUnavailableRef = useRef(false); // 501 → key not configured

  async function ensureLocalitiesLoaded() {
    if (!localitiesDb) {
      const db = await import('@/lib/data/bengaluru-localities');
      setLocalitiesDb({ major: db.getMajorAreas() });
    }
  }

  // The fragment after the last comma is what the user is currently typing.
  const activeQuery = useMemo(() => {
    const segments = areasText.split(',');
    return segments.length > 0 ? segments[segments.length - 1].trim() : '';
  }, [areasText]);

  const matchingSublocalities = useMemo(() => {
    if (!activeQuery) return [];
    const dataset = localitiesDb?.major || POPULAR_SUBLOCALITIES;
    return dataset.filter(area =>
      area.toLowerCase().includes(activeQuery.toLowerCase())
    ).slice(0, 10);
  }, [activeQuery, localitiesDb]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = activeQuery;
    if (!isFocused || query.length < 2 || mapsUnavailableRef.current) {
      setGoogleSuggestions([]);
      setGoogleLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      if (!sessionRef.current) sessionRef.current = crypto.randomUUID();
      const seq = ++requestSeqRef.current;
      setGoogleLoading(true);
      fetch(`/api/maps/autocomplete?input=${encodeURIComponent(query)}&session=${sessionRef.current}`)
        .then(async (res) => {
          if (res.status === 501) {
            mapsUnavailableRef.current = true;
            return { suggestions: [] };
          }
          if (!res.ok) return { suggestions: [] };
          return (await res.json()) as { suggestions: GoogleSuggestion[] };
        })
        .then(({ suggestions }) => {
          if (seq === requestSeqRef.current) setGoogleSuggestions(suggestions);
        })
        .catch(() => {
          if (seq === requestSeqRef.current) setGoogleSuggestions([]);
        })
        .finally(() => {
          if (seq === requestSeqRef.current) setGoogleLoading(false);
        });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeQuery, isFocused]);

  function commit(updated: string[]) {
    onChange(updated.join(', ') + (updated.length > 0 ? ', ' : ''), updated);
  }

  function handleTextChange(val: string) {
    const parsed = val.split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    onChange(val, Array.from(new Set(parsed)));
  }

  function toggleArea(area: string) {
    const isChecked = areasOfInterest.includes(area);
    let updated: string[];
    if (isChecked) {
      updated = areasOfInterest.filter(a => a !== area);
    } else {
      // Replace the partially typed fragment with the picked area
      const cleanList = areasOfInterest.filter(a => a.toLowerCase() !== activeQuery.toLowerCase());
      updated = [...cleanList, area];
    }
    commit(updated);
  }

  function pickGoogleArea(area: string) {
    const cleanList = areasOfInterest.filter(
      a => a.toLowerCase() !== activeQuery.toLowerCase() && a.toLowerCase() !== area.toLowerCase()
    );
    commit([...cleanList, area]);
    setGoogleSuggestions([]);
    sessionRef.current = null; // a pick ends the Google billing session
  }

  function addSuggestion(area: string) {
    if (!areasOfInterest.includes(area)) {
      commit([...areasOfInterest, area]);
    }
  }

  // Hide Google results that duplicate a curated sublocality match
  const dedupedGoogleSuggestions = googleSuggestions.filter(
    s => !matchingSublocalities.some(area => area.toLowerCase() === s.main_text.toLowerCase())
  );
  const dropdownOpen = isFocused && (matchingSublocalities.length > 0 || dedupedGoogleSuggestions.length > 0 || googleLoading);

  return (
    <>
      <div className="relative">
        <Input
          value={areasText}
          onChange={(e) => {
            ensureLocalitiesLoaded();
            handleTextChange(e.target.value);
          }}
          onFocus={() => {
            ensureLocalitiesLoaded();
            setIsFocused(true);
          }}
          onBlur={() => {
            // Slight delay to allow clicking on dropdown items
            setTimeout(() => setIsFocused(false), 200);
          }}
          placeholder="Type area (e.g. Whitefield, Koramangala)..."
          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs w-full focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
        />
        {googleLoading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-500 animate-spin" />
        )}

        {dropdownOpen && (
          <div
            className="absolute z-50 w-full mt-1 bg-slate-900 border border-slate-700 rounded-md shadow-lg max-h-56 overflow-y-auto p-1 space-y-0.5"
            onMouseDown={(e) => {
              // Prevent input blur so checks can be toggled without losing focus
              e.preventDefault();
            }}
          >
            {matchingSublocalities.length > 0 && (
              <>
                <div className="text-[10px] text-slate-500 font-semibold px-2 py-1 border-b border-slate-850 mb-1">
                  Matching Sublocalities:
                </div>
                {matchingSublocalities.map((area) => {
                  const isChecked = areasOfInterest.includes(area);
                  return (
                    <label
                      key={area}
                      className="flex items-center gap-2 px-2 py-1 hover:bg-slate-800 rounded text-xs text-slate-200 cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleArea(area)}
                        className="rounded border-slate-700 bg-slate-800 text-primary focus:ring-0 focus:ring-offset-0 size-3.5"
                      />
                      <span>{area}</span>
                    </label>
                  );
                })}
              </>
            )}

            {dedupedGoogleSuggestions.length > 0 && (
              <>
                <div className="text-[10px] text-slate-500 font-semibold px-2 py-1 border-b border-slate-850 mb-1 flex items-center gap-1">
                  <MapPin className="size-3 text-primary" />
                  Google Maps:
                </div>
                {dedupedGoogleSuggestions.map((s) => (
                  <button
                    key={s.place_id}
                    type="button"
                    onClick={() => pickGoogleArea(s.main_text)}
                    className="w-full flex items-start gap-2 px-2 py-1 hover:bg-slate-800 rounded text-xs text-slate-200 cursor-pointer text-left"
                  >
                    <MapPin className="size-3 text-primary mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate">{s.main_text}</span>
                      {s.secondary_text && (
                        <span className="block text-[10px] text-slate-500 truncate">{s.secondary_text}</span>
                      )}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Suggestions Bank */}
      <div className="flex flex-wrap gap-1 pt-1.5">
        <span className="text-[10px] text-slate-500 font-semibold w-full">Quick Add Suggestions:</span>
        {SUGGESTED_AREAS.map(area => {
          const exists = areasOfInterest.includes(area);
          return (
            <button
              key={area}
              type="button"
              disabled={exists}
              onClick={() => addSuggestion(area)}
              className="text-[10px] px-2 py-0.5 rounded border border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-slate-900 disabled:hover:text-slate-400"
            >
              +{area}
            </button>
          );
        })}
      </div>
    </>
  );
}
