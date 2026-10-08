import { formatCurrency } from '../format/currency';
import { isLocationGuarded, localityLabel } from './location-privacy';

export const CATALOG_INDEXING_SECONDS = 90;

export type CatalogShareStatus = 'not_synced' | 'failed' | 'indexing' | 'ready';

export interface CatalogShareState {
  status: CatalogShareStatus;
  secondsLeft: number;
}

export function catalogShareState(
  sync: {
    meta_catalog_synced_at?: string | null;
    meta_catalog_error?: string | null;
  },
  nowMs: number
): CatalogShareState {
  if (sync.meta_catalog_error) return { status: 'failed', secondsLeft: 0 };
  if (!sync.meta_catalog_synced_at) {
    return { status: 'not_synced', secondsLeft: 0 };
  }
  const syncedMs = new Date(sync.meta_catalog_synced_at).getTime();
  if (Number.isNaN(syncedMs)) return { status: 'ready', secondsLeft: 0 };
  const elapsed = (nowMs - syncedMs) / 1000;
  if (elapsed < CATALOG_INDEXING_SECONDS) {
    return {
      status: 'indexing',
      secondsLeft: Math.ceil(CATALOG_INDEXING_SECONDS - elapsed),
    };
  }
  return { status: 'ready', secondsLeft: 0 };
}

export function catalogProductRetailerId(p: {
  id: string;
  property_code?: string | null;
}): string {
  return p.property_code || p.id;
}

export function catalogProductCaption(
  p: {
    title: string;
    price?: number | string | null;
    type: string;
    location_privacy?: string | null;
    location?: string | null;
    sublocality?: string | null;
    city?: string | null;
    state?: string | null;
  },
  currency: string = 'INR'
): string {
  const amount = Number(p.price);
  const price =
    Number.isNaN(amount) || amount <= 0 ? '' : formatCurrency(amount, currency);
  const location =
    p.sublocality || (isLocationGuarded(p) ? localityLabel(p) : p.location);
  return `🏠 *${p.title}*\n💰 Price: ${price}\n📍 Location: ${location}`;
}

export interface CatalogSendResult {
  phone: string;
  status?: string | null;
  error?: string | null;
}

export function matchCatalogSendResults<
  C extends { id: string; phone: string | null },
>(
  contacts: C[],
  results: CatalogSendResult[] | undefined
): Array<{ contact: C; sent: boolean; error?: string }> {
  return contacts.map((contact) => {
    const match = (results ?? []).find(
      (r) =>
        contact.phone !== null &&
        (r.phone === contact.phone ||
          r.phone.includes(contact.phone) ||
          contact.phone.includes(r.phone))
    );
    const sent = match?.status === 'sent';
    return {
      contact,
      sent,
      error: sent
        ? undefined
        : match?.error || (match?.status ? 'Delivery failure' : undefined),
    };
  });
}
