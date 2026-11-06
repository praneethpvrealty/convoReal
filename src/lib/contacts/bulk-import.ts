import { contactPhone } from '../format/phone';

export interface BulkImportRow {
  name: string;
  phone: string;
}

export interface BulkImportProblem {
  index: number;
  label: string;
  reason: string;
}

export interface BulkImportPlan {
  ready: Array<{ index: number; phone: string }>;
  skipped: BulkImportProblem[];
}

export interface BulkImportResult {
  imported: number;
  problems: BulkImportProblem[];
}

export function bulkImportRowLabel(row: BulkImportRow): string {
  return row.name.trim() || row.phone.trim() || 'Unnamed contact';
}

export function planBulkImport(
  rows: readonly BulkImportRow[],
  defaultCountryCode: string
): BulkImportPlan {
  const ready: BulkImportPlan['ready'] = [];
  const skipped: BulkImportProblem[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const label = bulkImportRowLabel(row);
    if (!row.name.trim()) {
      skipped.push({ index, label, reason: 'No name' });
      return;
    }
    if (!row.phone.trim()) {
      skipped.push({ index, label, reason: 'No phone number' });
      return;
    }
    const phone = contactPhone(row.phone, defaultCountryCode);
    if (!phone) {
      skipped.push({ index, label, reason: 'Invalid phone number' });
      return;
    }
    if (seen.has(phone)) {
      skipped.push({
        index,
        label,
        reason: 'Same number as another row in this import',
      });
      return;
    }
    seen.add(phone);
    ready.push({ index, phone });
  });
  return { ready, skipped };
}

export function bulkImportFailureReason(error: {
  code?: string;
  message?: string;
}): string {
  if (error.code === '23505') return 'Already in your contacts';
  return error.message || 'Could not be saved';
}

export function bulkImportSummary(result: BulkImportResult): string {
  const imported = `Imported ${result.imported} contact${result.imported === 1 ? '' : 's'}`;
  if (result.problems.length === 0) return imported;
  return `${imported}; ${result.problems.length} not imported`;
}
