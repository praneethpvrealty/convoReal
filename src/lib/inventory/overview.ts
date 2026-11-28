import type {
  AttentionCountRow,
  SourceBreakdownRow,
} from '@/lib/inventory/list-scope';

export interface InventoryStats {
  total: number;
  published: number;
  available: number;
  soldOrContract: number;
  pendingReview: number;
  activeTotal: number;
}

export interface InventoryOverview {
  stats: InventoryStats;
  attention: AttentionCountRow[];
  sourceBreakdown: SourceBreakdownRow[];
}

export const EMPTY_INVENTORY_STATS: InventoryStats = {
  total: 0,
  published: 0,
  available: 0,
  soldOrContract: 0,
  pendingReview: 0,
  activeTotal: 0,
};

const count = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const rows = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

export function parseInventoryOverview(raw: unknown): InventoryOverview {
  const source =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const stats =
    source.stats && typeof source.stats === 'object'
      ? (source.stats as Record<string, unknown>)
      : {};
  return {
    stats: {
      total: count(stats.total),
      published: count(stats.published),
      available: count(stats.available),
      soldOrContract: count(stats.sold_or_contract),
      pendingReview: count(stats.pending_review),
      activeTotal: count(stats.active_total),
    },
    attention: rows<AttentionCountRow>(source.attention),
    sourceBreakdown: rows<SourceBreakdownRow>(source.source_breakdown),
  };
}
