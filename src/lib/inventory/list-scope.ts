export type InventoryTab = 'all' | 'review' | 'archived';
export type InventoryTile = 'all' | 'showcased' | 'available' | 'closed';
export type ListingParty = 'All' | 'Owner' | 'Agent';

export interface SourceBreakdownRow {
  status: string;
  is_published: boolean;
  agent_referred: boolean;
  listings: number | string;
}

export interface PartyCounts {
  All: number;
  Owner: number;
  Agent: number;
}

const TAB_LABELS: Record<InventoryTab, string> = {
  all: 'All Listings',
  review: 'Review',
  archived: 'Archived',
};

const TILE_LABELS: Record<Exclude<InventoryTile, 'all'>, string> = {
  showcased: 'Showcased',
  available: 'Available',
  closed: 'Sold or under contract',
};

const PARTY_LABELS: Record<Exclude<ListingParty, 'All'>, string> = {
  Owner: 'Direct',
  Agent: 'Agent referred',
};

function inScope(
  row: SourceBreakdownRow,
  tab: InventoryTab,
  tile: InventoryTile
): boolean {
  if (tab === 'review') return row.status === 'Pending Review';
  if (tab === 'archived') return row.status === 'Archived';
  if (row.status === 'Archived') return false;
  if (tile === 'available') return row.status === 'Available';
  if (tile === 'closed')
    return row.status === 'Sold' || row.status === 'Under Contract';
  if (tile === 'showcased') return row.is_published;
  return true;
}

export function partyCounts(
  rows: SourceBreakdownRow[],
  tab: InventoryTab,
  tile: InventoryTile
): PartyCounts {
  const counts: PartyCounts = { All: 0, Owner: 0, Agent: 0 };
  for (const row of rows) {
    if (!inScope(row, tab, tile)) continue;
    const n = Number(row.listings) || 0;
    counts.All += n;
    counts[row.agent_referred ? 'Agent' : 'Owner'] += n;
  }
  return counts;
}

export function tabCount(rows: SourceBreakdownRow[], tab: InventoryTab) {
  return partyCounts(rows, tab, 'all').All;
}

export interface InventoryEmptyStateInput {
  tab: InventoryTab;
  tile: InventoryTile;
  party: ListingParty;
  search: string;
  location: string | null;
}

export interface InventoryEmptyState {
  title: string;
  body: string;
  filtered: boolean;
}

export function inventoryEmptyState({
  tab,
  tile,
  party,
  search,
  location,
}: InventoryEmptyStateInput): InventoryEmptyState {
  const filters: string[] = [];
  if (tab === 'all' && tile !== 'all') filters.push(TILE_LABELS[tile]);
  if (party !== 'All') filters.push(PARTY_LABELS[party]);
  if (search.trim()) filters.push(`“${search.trim()}”`);
  if (location) filters.push(location);

  if (filters.length > 0) {
    return {
      title: 'No listings match these filters',
      body: `Nothing in ${TAB_LABELS[tab]} matches ${filters.join(' · ')}.`,
      filtered: true,
    };
  }
  if (tab === 'review') {
    return {
      title: 'Nothing waiting for review',
      body: 'Listings imported from portals or shared by other agents wait here until you approve them.',
      filtered: false,
    };
  }
  if (tab === 'archived') {
    return {
      title: 'Nothing archived',
      body: 'Listings you archive are kept here, out of your active inventory and showcase.',
      filtered: false,
    };
  }
  return {
    title: 'No listings yet',
    body: 'Add your first property to start building your inventory.',
    filtered: false,
  };
}
