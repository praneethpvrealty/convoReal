import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyBuyersOfPropertyStatus } from '@/lib/whatsapp/sold-notification';

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
  status: string
): Promise<boolean> {
  const { data: before } = await db
    .from('properties')
    .select('status')
    .eq('id', propertyId)
    .eq('account_id', accountId)
    .maybeSingle();
  const { data: synced } = await db
    .from('properties')
    .update({ status })
    .eq('id', propertyId)
    .eq('account_id', accountId)
    .select('id');
  if (!synced?.length) return false;

  if (
    listingReopened(
      (before as { status?: string | null } | null)?.status,
      status
    )
  ) {
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
