export interface TransactionIndexParties {
  title: string;
  contact_name: string | null;
  property_title: string | null;
  property_unit_no: string | null;
}

export interface TransactionIndexOrigin {
  source_journey_item_id: string | null;
  milestones_total: number;
}

export const NOT_YET_TRANSACTION_LABEL = 'Not yet a transaction';
export const NOT_YET_TRANSACTION_HINT =
  'A pipeline deal with no milestones. Add the standard checklist to start the closing record.';

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function transactionPropertyLabel(
  row: Pick<TransactionIndexParties, 'property_title' | 'property_unit_no'>
): string | null {
  const unit = clean(row.property_unit_no);
  if (unit) return `Property No. ${unit}`;
  return clean(row.property_title);
}

export function transactionTitle(row: TransactionIndexParties): string {
  const who = clean(row.contact_name);
  const what = transactionPropertyLabel(row);
  if (who && what) return `${who} — ${what}`;
  return who ?? what ?? row.title;
}

export function transactionSubtitle(
  row: TransactionIndexParties
): string | null {
  const title = clean(row.title);
  if (!title) return null;
  const headline = transactionTitle(row);
  if (headline.toLowerCase().includes(title.toLowerCase())) return null;
  return title;
}

export function isClosingRecord(row: TransactionIndexOrigin): boolean {
  return row.source_journey_item_id !== null || row.milestones_total > 0;
}
