'use client';

import { useDeferredValue } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  CalendarDays,
  Search,
  UserRound,
} from 'lucide-react';
import type {
  ActiveEntityQuery,
  EntitySuggestion,
  EntitySymbol,
} from '@/lib/copilot/entities';

interface CopilotEntityPickerProps {
  active: ActiveEntityQuery;
  onSelect: (entity: EntitySuggestion) => void;
}

async function fetchEntitySuggestions(
  symbol: EntitySymbol,
  query: string
): Promise<EntitySuggestion[]> {
  const params = new URLSearchParams({ symbol, q: query });
  const response = await fetch(`/api/copilot/entities?${params}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = (await response.json()) as { data?: EntitySuggestion[] };
  return result.data ?? [];
}

export function CopilotEntityPicker({
  active,
  onSelect,
}: CopilotEntityPickerProps) {
  const query = useDeferredValue(active.query);

  const results = useQuery({
    queryKey: ['copilot-entities', active.symbol, query],
    queryFn: () => fetchEntitySuggestions(active.symbol, query),
    staleTime: 30_000,
  });

  const title =
    active.symbol === '#'
      ? 'Choose a property'
      : active.symbol === '@'
        ? 'Choose a contact'
        : 'Choose a calendar event';

  return (
    <div className="shrink-0 border-t border-slate-800 bg-slate-950/98 p-2">
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-slate-400">
        <Search className="h-3 w-3" />
        {title}
      </div>
      <div className="max-h-56 overflow-y-auto">
        {results.isPending && (
          <p className="px-3 py-4 text-center text-xs text-slate-500">
            Searching…
          </p>
        )}
        {!results.isPending &&
          (results.data ?? []).map((entity) => {
            const Icon =
              entity.kind === 'property'
                ? Building2
                : entity.kind === 'contact'
                  ? UserRound
                  : CalendarDays;
            return (
              <button
                key={`${entity.kind}:${entity.id}`}
                type="button"
                onClick={() => onSelect(entity)}
                className="hover:border-primary/30 flex w-full items-start gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left hover:bg-slate-900"
              >
                <span className="bg-primary/15 text-primary mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">
                    <span className="text-primary mr-0.5">{entity.symbol}</span>
                    {entity.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                    {entity.subtitle || 'No additional details'}
                  </span>
                </span>
                {entity.status && (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 capitalize">
                    {entity.status}
                  </span>
                )}
              </button>
            );
          })}
        {!results.isPending && (results.data ?? []).length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-slate-500">
            No matching records
          </p>
        )}
      </div>
    </div>
  );
}
