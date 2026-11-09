import type { Ionicons } from '@expo/vector-icons';
import { withAnalyticsTimeout } from '@/lib/analytics-request';
import { supabase } from '@/lib/supabase';
import {
  PULSE_ENQUIRY_PAGE_SIZE,
  pulseEnquiryCountsSince,
  tallyPulseEnquiryCounts,
  type PulseEnquiryCursor,
  type PulseEnquiryKind,
  type PulseEnquiryRow,
} from '@shared/lib/pulse/enquiries';

/**
 * Web parity: the Pulse "Enquiries & requests" view
 * (src/components/pulse/enquiries-panel.tsx). The rows, their wording
 * and the follow-up flag come from the shared module; this file only
 * fetches them and names the icon for each kind.
 */

export const ENQUIRY_KIND_ICONS: Record<
  PulseEnquiryKind,
  React.ComponentProps<typeof Ionicons>['name']
> = {
  enquiry: 'mail-open-outline',
  location_request: 'location-outline',
  document_request: 'document-text-outline',
  rating: 'star-outline',
  shortlist: 'bookmark-outline',
  whatsapp_tap: 'logo-whatsapp',
  check_in: 'chatbubble-ellipses-outline',
};

export async function fetchPulseEnquiries(
  accountId: string,
  cursor: PulseEnquiryCursor | null = null
): Promise<PulseEnquiryRow[]> {
  return withAnalyticsTimeout(
    fetchPulseEnquiriesUnbounded(accountId, cursor),
    'Showcase Pulse enquiries'
  );
}

async function fetchPulseEnquiriesUnbounded(
  accountId: string,
  cursor: PulseEnquiryCursor | null
): Promise<PulseEnquiryRow[]> {
  const { data, error } = await supabase.rpc('pulse_enquiries', {
    p_account_id: accountId,
    p_before: cursor?.before ?? null,
    p_before_id: cursor?.beforeId ?? null,
    p_limit: PULSE_ENQUIRY_PAGE_SIZE,
  });
  if (error) throw error;
  return (data ?? []) as PulseEnquiryRow[];
}

export async function fetchPulseEnquiryCounts(
  accountId: string
): Promise<Record<PulseEnquiryKind, number>> {
  return withAnalyticsTimeout(
    fetchPulseEnquiryCountsUnbounded(accountId),
    'Showcase Pulse enquiry counts'
  );
}

async function fetchPulseEnquiryCountsUnbounded(
  accountId: string
): Promise<Record<PulseEnquiryKind, number>> {
  const { data, error } = await supabase.rpc('pulse_enquiry_counts', {
    p_account_id: accountId,
    p_since: pulseEnquiryCountsSince(),
  });
  if (error) throw error;
  return tallyPulseEnquiryCounts(
    (data ?? []) as Array<{ kind: string; total: number | string }>
  );
}
