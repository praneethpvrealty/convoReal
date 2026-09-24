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

export type RecordsSort = 'updated' | 'close';

/** Mirrored in mobile/lib/deal-workspace.ts; guarded by mobile-parity.test.ts. */
export const RECORDS_SORTS: ReadonlyArray<{ id: RecordsSort; label: string }> =
  [
    { id: 'updated', label: 'Recent' },
    { id: 'close', label: 'Close date' },
  ];

export interface TransactionIndexDates {
  expected_close_date: string | null;
  actual_close_date: string | null;
  updated_at: string;
}

/** "Closes 2026-10-10", "Close date passed", "Closed 2026-10-08", or
 *  null when no date was forecast. `today` is YYYY-MM-DD in the
 *  reader's calendar. */
export function expectedCloseLabel(
  row: Pick<TransactionIndexDates, 'expected_close_date' | 'actual_close_date'>,
  today: string
): { text: string; tone: 'done' | 'overdue' | 'soon' | 'later' } | null {
  if (row.actual_close_date) {
    return { text: `Closed ${row.actual_close_date}`, tone: 'done' };
  }
  if (!row.expected_close_date) return null;
  if (row.expected_close_date < today) {
    return {
      text: `Close date passed (${row.expected_close_date})`,
      tone: 'overdue',
    };
  }
  const soon = daysBetweenKeys(today, row.expected_close_date) <= 7;
  return {
    text: `Closes ${row.expected_close_date}`,
    tone: soon ? 'soon' : 'later',
  };
}

function daysBetweenKeys(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10))
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10))
  );
  return Math.round((b - a) / 86_400_000);
}

/** Close date: soonest expected close first, dated before undated,
 *  already-closed last. Recent: the index's own order. */
export function sortIndexRows<T extends TransactionIndexDates>(
  rows: readonly T[],
  sort: RecordsSort
): T[] {
  if (sort === 'updated') return [...rows];
  return [...rows].sort((a, b) => {
    const aClosed = Boolean(a.actual_close_date);
    const bClosed = Boolean(b.actual_close_date);
    if (aClosed !== bClosed) return aClosed ? 1 : -1;
    if (a.expected_close_date && b.expected_close_date) {
      return (
        a.expected_close_date.localeCompare(b.expected_close_date) ||
        b.updated_at.localeCompare(a.updated_at)
      );
    }
    if (Boolean(a.expected_close_date) !== Boolean(b.expected_close_date)) {
      return a.expected_close_date ? -1 : 1;
    }
    return b.updated_at.localeCompare(a.updated_at);
  });
}
