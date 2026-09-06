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
