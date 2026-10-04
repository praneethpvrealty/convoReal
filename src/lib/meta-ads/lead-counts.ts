interface AdContactCountRow {
  source_id: string | null;
  contacts: number | string | null;
}

export function leadCountsByAd(rows: AdContactCountRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.source_id) continue;
    counts.set(row.source_id, Number(row.contacts ?? 0));
  }
  return counts;
}
