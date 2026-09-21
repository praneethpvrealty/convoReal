export interface InventoryImport {
  id: string;
  agentName: string | null;
  agencyName: string;
  recordedAt: string;
  status: string;
}

export interface InventoryImportsResponse {
  data: InventoryImport[];
  nextPage: number | null;
}

export function inventoryImportStatus(
  status: string,
  accountStatus: string
): string {
  if (accountStatus === 'archived') return 'Agency archived';
  switch (status) {
    case 'Pending Review':
      return 'Pending review';
    case 'Rejected':
      return 'Rejected';
    case 'Archived':
      return 'Archived';
    case 'Available':
    case 'Under Contract':
    case 'Sold':
    case 'Off Market':
      return 'In inventory';
    default:
      return 'Status unavailable';
  }
}

interface ImportCountRow {
  property_id: string;
  import_count: number | null;
}

export type ImportCountMap = Record<string, number>;

export function toImportCountMap(
  rows: ImportCountRow[] | null | undefined
): ImportCountMap {
  const map: ImportCountMap = {};
  for (const row of rows ?? []) {
    if (!row?.property_id) continue;
    const count =
      typeof row.import_count === 'number' && Number.isFinite(row.import_count)
        ? row.import_count
        : 0;
    if (count > 0) map[row.property_id] = count;
  }
  return map;
}

export function importCountLabel(count: number): string {
  return `Shared by ${count} ${count === 1 ? 'agent' : 'agents'}`;
}
