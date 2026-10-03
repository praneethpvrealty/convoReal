import { Archive, Building, ClipboardCheck, SearchX } from 'lucide-react';
import type {
  InventoryEmptyState as EmptyStateCopy,
  InventoryTab,
} from '@/lib/inventory/list-scope';

interface InventoryEmptyStateProps {
  copy: EmptyStateCopy;
  tab: InventoryTab;
  onClearFilters: () => void;
}

export function InventoryEmptyState({
  copy,
  tab,
  onClearFilters,
}: InventoryEmptyStateProps) {
  const Icon = copy.filtered
    ? SearchX
    : tab === 'review'
      ? ClipboardCheck
      : tab === 'archived'
        ? Archive
        : Building;
  return (
    <div
      data-testid="inventory-empty-state"
      className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 py-16 text-center"
    >
      <Icon className="mx-auto mb-4 size-12 text-slate-600" />
      <h3 className="mb-1 text-lg font-semibold text-white">{copy.title}</h3>
      <p className="mx-auto max-w-sm text-sm text-slate-400">{copy.body}</p>
      {copy.filtered && (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-4 rounded-full border border-slate-700 bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-200 hover:text-white"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
