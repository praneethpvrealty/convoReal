import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyBuyersOfPropertyStatus } from '@/lib/whatsapp/sold-notification';
import { propertyStatusForPipelineStage } from '@/lib/pipelines/stage-semantics';

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

type HeldDeal = {
  status: string | null;
  stage: { name?: string | null } | { name?: string | null }[] | null;
};

export function statusHeldByDeals(deals: readonly HeldDeal[]): string | null {
  let held: string | null = null;
  for (const deal of deals) {
    const stage = Array.isArray(deal.stage) ? deal.stage[0] : deal.stage;
    const fromStage = stage?.name
      ? propertyStatusForPipelineStage(stage.name)
      : null;
    if (deal.status === 'won' || fromStage === 'Sold') return 'Sold';
    if (fromStage === 'Under Contract') held = 'Under Contract';
  }
  return held;
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
  let target = status;
  if (status === 'Available') {
    const { data: deals } = await db
      .from('deals')
      .select('status, stage:pipeline_stages(name)')
      .eq('account_id', accountId)
      .eq('property_id', propertyId)
      .in('status', ['open', 'won']);
    target = statusHeldByDeals((deals ?? []) as HeldDeal[]) ?? status;
  }
  const { data: synced } = await db
    .from('properties')
    .update({ status: target })
    .eq('id', propertyId)
    .eq('account_id', accountId)
    .select('id');
  if (!synced?.length) return false;

  if (
    listingReopened(
      (before as { status?: string | null } | null)?.status,
      target
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
