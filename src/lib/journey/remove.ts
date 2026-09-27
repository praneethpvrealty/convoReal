export type RemoveJourneyInput =
  { itemIds: string[] } | { mode: 'buyer' | 'property'; subjectId: string };

export interface RemoveJourneyResult {
  items: number;
  deals: number;
  failedDeals: string[];
}

/**
 * Remove journey branches and the deals opened from them, through the
 * server route both surfaces use. The browser never deletes
 * journey_items itself: a branch and its deal go together.
 */
export async function removeJourneyItems(
  input: RemoveJourneyInput
): Promise<RemoveJourneyResult> {
  const res = await fetch('/api/journey/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      'itemIds' in input
        ? { item_ids: input.itemIds }
        : { mode: input.mode, subject_id: input.subjectId }
    ),
  });
  const payload = (await res.json().catch(() => null)) as {
    data?: { items?: number; deals?: number; failed_deals?: string[] };
    error?: string;
  } | null;
  if (!res.ok) {
    throw new Error(payload?.error || `Remove failed (${res.status})`);
  }
  return {
    items: payload?.data?.items ?? 0,
    deals: payload?.data?.deals ?? 0,
    failedDeals: payload?.data?.failed_deals ?? [],
  };
}
