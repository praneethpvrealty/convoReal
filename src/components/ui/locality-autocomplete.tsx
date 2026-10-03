'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { MapPin, Loader2 } from 'lucide-react';

/**
 * Google Places locality autocomplete, proxied through /api/maps/* so the
 * API key stays server-side. Degrades to a plain text input when the key
 * isn't configured (the proxy answers 501) — callers still get onChange
 * text updates in that case, just no suggestions.
 *
 * A session token (crypto.randomUUID) spans one typing session and its
 * place-details pick, which is how Google bills autocomplete sessions.
 */

export interface PickedLocality {
  place_id: string;
  /** Primary name, e.g. "HSR Layout". */
  name: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  sublocality: string | null;
  city: string | null;
  state: string | null;
}

interface Suggestion {
  place_id: string;
  main_text: string;
  secondary_text: string;
}

interface LocalityAutocompleteProps {
  value: string;
  onChange: (text: string) => void;
  onPick: (place: PickedLocality) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function LocalityAutocomplete({
  value,
  onChange,
  onPick,
  placeholder = 'Search locality, e.g. HSR Layout',
  className,
  disabled,
}: LocalityAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false); // 501 → plain input
  const sessionRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against stale responses overwriting newer ones
  const requestSeqRef = useRef(0);

  // Close the dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const fetchSuggestions = useCallback(
    (input: string) => {
      if (unavailable) return;
      if (!sessionRef.current) sessionRef.current = crypto.randomUUID();
      const seq = ++requestSeqRef.current;
      setLoading(true);

      fetch(
        `/api/maps/autocomplete?input=${encodeURIComponent(input)}&session=${sessionRef.current}`
      )
        .then(async (res) => {
          if (res.status === 501) {
            setUnavailable(true);
            return { suggestions: [] };
          }
          if (!res.ok) return { suggestions: [] };
          return (await res.json()) as { suggestions: Suggestion[] };
        })
        .then(({ suggestions: next }) => {
          if (seq !== requestSeqRef.current) return; // stale
          setSuggestions(next);
          setOpen(next.length > 0);
        })
        .catch(() => {
          if (seq === requestSeqRef.current) setSuggestions([]);
        })
        .finally(() => {
          if (seq === requestSeqRef.current) setLoading(false);
        });
    },
    [unavailable]
  );

  function handleInput(text: string) {
    onChange(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => fetchSuggestions(text.trim()), 300);
  }

  async function handlePick(s: Suggestion) {
    setOpen(false);
    setSuggestions([]);
    onChange(s.main_text);
    setLoading(true);
    try {
      const session = sessionRef.current;
      sessionRef.current = null; // details pick closes the billing session
      const res = await fetch(
        `/api/maps/place-details?place_id=${encodeURIComponent(s.place_id)}${
          session ? `&session=${session}` : ''
        }`
      );
      if (!res.ok) return;
      const { place } = (await res.json()) as { place: PickedLocality };
      onPick(place);
    } catch {
      // Text stays in the input; the server-side geocode fallback will
      // still resolve coordinates on save.
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
        <Input
          value={value}
          disabled={disabled}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className={
            className ??
            'h-9 border-slate-700 bg-slate-800 pl-9 text-white placeholder:text-slate-500'
          }
        />
        {loading && (
          <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-slate-500" />
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {suggestions.map((s) => (
            <button
              key={s.place_id}
              type="button"
              onClick={() => handlePick(s)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-800"
            >
              <MapPin className="text-primary mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-white">
                  {s.main_text}
                </span>
                {s.secondary_text && (
                  <span className="block truncate text-[10px] text-slate-500">
                    {s.secondary_text}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
