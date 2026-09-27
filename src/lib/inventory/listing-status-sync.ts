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

const DEAL_STATUS_RANK: Record<string, number> = {
  Available: 0,
  'Under Contract': 1,
  Sold: 2,
};

function stronger(a: string, b: string | null): string {
  if (!b) return a;
  return (DEAL_STATUS_RANK[b] ?? 0) > (DEAL_STATUS_RANK[a] ?? 0) ? b : a;
}

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
  const [{ data: before }, { data: deals, error: dealsError }] =
    await Promise.all([
      db
        .from('properties')
        .select('status')
        .eq('id', propertyId)
        .eq('account_id', accountId)
        .maybeSingle(),
      db
        .from('deals')
        .select('status, stage:pipeline_stages(name)')
        .eq('account_id', accountId)
        .eq('property_id', propertyId)
        .in('status', ['open', 'won']),
    ]);
  if (dealsError) {
    console.error(
      '[listing-status-sync] Deals holding the listing could not be read:',
      dealsError.message
    );
    return false;
  }

  const target = stronger(
    status,
    statusHeldByDeals((deals ?? []) as HeldDeal[])
  );
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

export async function listingsWithJourneyDeals(
  db: SupabaseClient,
  accountId: string,
  mode: 'buyer' | 'property',
  subjectId: string
): Promise<string[]> {
  const { data: items } = await db
    .from('journey_items')
    .select('id')
    .eq('account_id', accountId)
    .eq(mode === 'buyer' ? 'contact_id' : 'property_id', subjectId)
    .limit(200);
  const itemIds = ((items ?? []) as { id: string }[]).map((row) => row.id);
  if (itemIds.length === 0) return [];
  const { data: deals } = await db
    .from('deals')
    .select('property_id')
    .eq('account_id', accountId)
    .in('source_journey_item_id', itemIds)
    .not('property_id', 'is', null);
  return [
    ...new Set(
      ((deals ?? []) as { property_id: string | null }[])
        .map((row) => row.property_id)
        .filter((id): id is string => !!id)
    ),
  ];
}
