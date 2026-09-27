import type { SupabaseClient } from '@supabase/supabase-js';

import { DEAL_DOCUMENT_BUCKET } from '@/lib/invoices/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { setListingStatusFromDeal } from '@/lib/inventory/listing-status-sync';

export type DeleteDealResult =
  { ok: true } | { ok: false; status: 404 | 500; error: string };

/**
 * Delete a deal the way DELETE /api/deals/[id] does, so the journey can
 * remove a branch's deal with the same care: the document objects are
 * read before the cascade takes their rows, removed from the bucket
 * afterwards, and the property is released. Shared with that route so
 * the two cannot drift.
 */
export async function deleteDealWithCleanup(
  ctx: { supabase: SupabaseClient; accountId: string },
  dealId: string
): Promise<DeleteDealResult> {
  const { data: deal, error: dealErr } = await ctx.supabase
    .from('deals')
    .select('property_id')
    .eq('id', dealId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (dealErr) {
    console.error('[deals/delete] Deal lookup:', dealErr);
    return {
      ok: false,
      status: 500,
      error: 'Could not read this deal, so it was not deleted. Try again.',
    };
  }
  if (!deal) {
    return { ok: false, status: 404, error: 'Deal not found' };
  }

  const { data: docs, error: docsErr } = await ctx.supabase
    .from('deal_documents')
    .select('storage_path')
    .eq('deal_id', dealId)
    .eq('account_id', ctx.accountId);
  if (docsErr) {
    console.error('[deals/delete] Document lookup:', docsErr);
    return {
      ok: false,
      status: 500,
      error:
        "Could not read this deal's documents, so it was not deleted. Try again.",
    };
  }

  const { data: deleted, error: deleteErr } = await ctx.supabase
    .from('deals')
    .delete()
    .eq('id', dealId)
    .eq('account_id', ctx.accountId)
    .select('id');
  if (deleteErr) {
    console.error('[deals/delete] Delete error:', deleteErr);
    return {
      ok: false,
      status: 500,
      error: deleteErr.message ?? 'Failed to delete deal',
    };
  }
  if (!deleted?.length) {
    return { ok: false, status: 404, error: 'Deal not found' };
  }

  const orphaned = (docs ?? [])
    .map((doc) => doc.storage_path)
    .filter(
      (path): path is string =>
        typeof path === 'string' &&
        !path.includes('..') &&
        path.startsWith(`${DEAL_DOCUMENT_BUCKET}/${ctx.accountId}/${dealId}/`)
    )
    .map((path) => path.slice(DEAL_DOCUMENT_BUCKET.length + 1));
  if (orphaned.length > 0) {
    const { error: removeErr } = await supabaseAdmin()
      .storage.from(DEAL_DOCUMENT_BUCKET)
      .remove(orphaned);
    if (removeErr) {
      console.warn('[deals/delete] Deal document objects not removed:', dealId);
    }
  }

  if (deal.property_id) {
    const released = await setListingStatusFromDeal(
      ctx.supabase,
      ctx.accountId,
      deal.property_id,
      'Available'
    );
    if (!released) {
      console.warn('[deals/delete] Property not released:', deal.property_id);
    }
  }

  return { ok: true };
}
