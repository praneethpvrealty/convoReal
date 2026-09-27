import { apiFetch } from '@/lib/api';

export interface SellerPageStatus {
  enabled: boolean;
  url: string | null;
  listing_count: number;
  owns_listings: boolean;
  share_message: string | null;
}

export type SellerPageAction = 'enable' | 'rotate' | 'disable';

export function sellerPagePath(contactId: string): string {
  return `/api/contacts/${contactId}/seller-page`;
}

export async function fetchSellerPage(
  contactId: string
): Promise<SellerPageStatus> {
  const response = await apiFetch<{ data: SellerPageStatus }>(
    sellerPagePath(contactId)
  );
  return response.data;
}

export async function updateSellerPage(
  contactId: string,
  action: SellerPageAction
): Promise<SellerPageStatus> {
  const response = await apiFetch<{ data: SellerPageStatus }>(
    sellerPagePath(contactId),
    action === 'disable'
      ? { method: 'DELETE' }
      : {
          method: 'POST',
          body: JSON.stringify({ rotate: action === 'rotate' }),
        }
  );
  return response.data;
}
