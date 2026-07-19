import { apiFetch } from '@/lib/api';

/**
 * Owners Den API client — same /api/den routes the web portal calls;
 * they authenticate via the Authorization: Bearer transport.
 */

export interface DenMe {
  den_user_id: string;
  phone: string;
  display_name: string | null;
  notify_matches: boolean;
  notify_bids: boolean;
  digest_frequency: 'off' | 'daily' | 'weekly';
  links: { account_id: string; contact_id: string; agency_name: string | null }[];
  property_count: number;
}

export interface DenDashboardProperty {
  property_id: string;
  title?: string | null;
  inquiries: number;
  shortlisted: number;
  visits: number;
  views: number;
  agency_name: string | null;
  status: string | null;
  is_published: boolean;
  deal_mode: string;
  listing_type: string | null;
  price: number | null;
  rent_per_month: number | null;
  cover_image: string | null;
}

export interface DenDashboard {
  period: { days: number; label: string };
  totals: { inquiries: number; shortlisted: number; visits: number; views: number };
  properties: DenDashboardProperty[];
}

export interface DenBid {
  id: string;
  property_id: string;
  property_title: string;
  property_image: string | null;
  amount: number | null;
  bid_type: string | null;
  message: string | null;
  status: string;
  counter_amount: number | null;
  counter_message: string | null;
  expires_at: string | null;
  created_at: string;
  resolved_at: string | null;
  bidder_agency: string;
  /** Masked until the bid is accepted. */
  bidder_contact: { name: string | null; phone: string | null } | null;
  deal_room_id: string | null;
}

/** Idempotent — the web client calls it on every login too. */
export function completeDenAuth(displayName?: string) {
  return apiFetch<{ den_user_id: string }>('/api/den/auth/complete', {
    method: 'POST',
    body: JSON.stringify(displayName ? { display_name: displayName } : {}),
  });
}

export function fetchDenMe() {
  return apiFetch<DenMe>('/api/den/me');
}

export function fetchDenDashboard(days: 7 | 30) {
  return apiFetch<DenDashboard>(`/api/den/dashboard?days=${days}`);
}

export function fetchDenBids() {
  return apiFetch<{ bids: DenBid[] }>('/api/den/bids');
}

export function respondToBid(bidId: string, action: 'accept' | 'reject') {
  return apiFetch<{ ok?: boolean }>(`/api/den/bids/${bidId}`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
}

export function updateDenSettings(update: {
  display_name?: string;
  notify_matches?: boolean;
  notify_bids?: boolean;
  digest_frequency?: 'off' | 'daily' | 'weekly';
}) {
  return apiFetch<DenMe>('/api/den/settings', {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
}
