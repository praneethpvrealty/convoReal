export const INVENTORY_SYNC_HEADER = 'x-inventory-sync';

export interface CardListRequest {
  path: string;
  init: { headers: Record<string, string> };
}

/**
 * The list and map ask for card columns only, and tell the route this
 * client runs the source-inventory sync itself, so the list is never
 * followed by a second sync on the server.
 */
export function cardListRequest(params: URLSearchParams): CardListRequest {
  const next = new URLSearchParams(params);
  next.set('fields', 'card');
  return {
    path: `/api/properties?${next.toString()}`,
    init: { headers: { [INVENTORY_SYNC_HEADER]: 'client' } },
  };
}

export function syncImportedListings(body: unknown): boolean {
  const data =
    body && typeof body === 'object'
      ? (body as { data?: { imported?: unknown } }).data
      : null;
  return Number(data?.imported) > 0;
}
