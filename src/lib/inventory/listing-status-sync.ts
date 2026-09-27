import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyBuyersOfPropertyStatus } from '@/lib/whatsapp/sold-notification';

export type DealDrivenListingStatus = 'Available' | 'Under Contract' | 'Sold';

export function listingReopened(
  previous: string | null | undefined,
  next: string
): boolean {
  return (
    next === 'Available' &&
    !!previous &&
    previous !== 'Available' &&
    previous !== 'Pending Review'
  );
}

export async function setListingStatusFromDeal(
  db: SupabaseClient,
  accountId: string,
  propertyId: string,
  status: DealDrivenListingStatus
): Promise<boolean> {
  const { data, error } = await db.rpc('sync_listing_status_from_deals', {
    p_account_id: accountId,
    p_property_id: propertyId,
    p_requested: status,
  });
  if (error) {
    console.error(
      '[listing-status-sync] Listing status not synced:',
      error.message
    );
    return false;
  }
  const row = (
    (data ?? []) as { previous_status: string | null; new_status: string }[]
  )[0];
  if (!row) return false;

  if (listingReopened(row.previous_status, row.new_status)) {
    after(() =>
      notifyBuyersOfPropertyStatus(accountId, propertyId, 'Available').then(
        () => undefined,
        (err) =>
          console.error(
            '[listing-status-sync] Available-again notification failed:',
            err
          )
      )
    );
  }
  return true;
}

export async function listingsWithJourneyDeals(
  db: SupabaseClient,
  accountId: string,
  mode: 'buyer' | 'property',
  subjectId: string
): Promise<string[] | null> {
  const { data, error } = await db.rpc('journey_deal_listings', {
    p_account_id: accountId,
    p_mode: mode,
    p_subject_id: subjectId,
  });
  if (error) {
    console.error(
      '[listing-status-sync] Journey deal listings could not be read:',
      error.message
    );
    return null;
  }
  return ((data ?? []) as string[]).filter(Boolean);
}
