// ============================================================
// POST /api/portal-import/commit — act on staged import items.
//
//   { action: 'link',   itemId, propertyId }  agent picked a match
//   { action: 'create', itemIds: [...] }      import as new property
//   { action: 'ignore', itemIds: [...] }      hide from the queue
//
// Duplicate-proofing:
//   * An item whose matched_property_id is already set commits as a
//     no-op link — a listing can only ever be imported once.
//   * 'create' collapses the item's whole batch_group (the same
//     property harvested from several portals) into ONE property,
//     linking every member to it.
//   * property_portal_listings upserts on (property_id, portal) and
//     the partial unique index on (account_id, portal,
//     portal_listing_id) makes double-linking impossible even under
//     concurrent commits.
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse, type AccountContext } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';

interface StagedItem {
  id: string;
  portal: string;
  portal_listing_id: string;
  listing_url: string | null;
  title: string | null;
  property_type: string | null;
  listing_for: string | null;
  price: number | null;
  bedrooms: number | null;
  area_sqft: number | null;
  locality: string | null;
  city: string | null;
  posted_on: string | null;
  expires_on: string | null;
  portal_status: string | null;
  views: number | null;
  responses: number | null;
  match_status: string;
  matched_property_id: string | null;
  batch_group: string | null;
  raw_text: string | null;
}

function linkStatus(item: StagedItem): 'active' | 'expired' | 'removed' {
  if (item.portal_status === 'expired') return 'expired';
  if (item.portal_status === 'inactive') return 'removed';
  return 'active';
}

async function linkItemsToProperty(ctx: AccountContext, items: StagedItem[], propertyId: string) {
  const now = new Date().toISOString();
  const { error: linkError } = await ctx.supabase.from('property_portal_listings').upsert(
    items.map((item) => ({
      account_id: ctx.accountId,
      property_id: propertyId,
      user_id: ctx.userId,
      portal: item.portal,
      portal_listing_id: item.portal_listing_id,
      listing_url: item.listing_url,
      posted_at: item.posted_on ? `${item.posted_on}T00:00:00Z` : now,
      expires_on: item.expires_on,
      status: linkStatus(item),
      views: item.views,
      responses: item.responses,
      last_synced_at: now,
    })),
    { onConflict: 'property_id,portal' }
  );
  if (linkError) throw linkError;

  const { error: itemError } = await ctx.supabase
    .from('portal_import_items')
    .update({ match_status: 'imported', matched_property_id: propertyId })
    .in('id', items.map((i) => i.id))
    .eq('account_id', ctx.accountId);
  if (itemError) throw itemError;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const rate = checkRateLimit(`portal-import-commit:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!rate.success) return rateLimitResponse(rate);

    const body = (await request.json().catch(() => null)) as
      | { action?: string; itemId?: string; itemIds?: string[]; propertyId?: string }
      | null;
    const action = body?.action;
    const itemIds = body?.itemIds || (body?.itemId ? [body.itemId] : []);
    if (!action || !['link', 'create', 'ignore'].includes(action) || itemIds.length === 0) {
      return NextResponse.json({ error: 'action and itemId(s) are required' }, { status: 400 });
    }
    if (itemIds.length > 100) {
      return NextResponse.json({ error: 'Too many items in one commit (max 100)' }, { status: 400 });
    }

    const { data: itemsData, error: itemsError } = await ctx.supabase
      .from('portal_import_items')
      .select('id, portal, portal_listing_id, listing_url, title, property_type, listing_for, price, bedrooms, area_sqft, locality, city, posted_on, expires_on, portal_status, views, responses, match_status, matched_property_id, batch_group, raw_text')
      .eq('account_id', ctx.accountId)
      .in('id', itemIds);
    if (itemsError) throw itemsError;
    const items = (itemsData || []) as StagedItem[];
    if (items.length === 0) {
      return NextResponse.json({ error: 'No matching import items' }, { status: 404 });
    }

    if (action === 'ignore') {
      const { error } = await ctx.supabase
        .from('portal_import_items')
        .update({ match_status: 'ignored' })
        .in('id', items.map((i) => i.id))
        .eq('account_id', ctx.accountId)
        .is('matched_property_id', null);
      if (error) throw error;
      return NextResponse.json({ data: { ignored: items.length } });
    }

    if (action === 'link') {
      const propertyId = body?.propertyId;
      if (!propertyId) {
        return NextResponse.json({ error: 'propertyId is required for link' }, { status: 400 });
      }
      const { data: property, error: propError } = await ctx.supabase
        .from('properties')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('id', propertyId)
        .maybeSingle();
      if (propError) throw propError;
      if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

      // Already-imported items keep their original property — silently
      // relinking would orphan the earlier property's portal row.
      const alreadyCommitted = items.filter((i) => i.matched_property_id && i.matched_property_id !== propertyId);
      if (alreadyCommitted.length > 0) {
        return NextResponse.json(
          { error: 'Item is already linked to another property. Unlink it from that property first.' },
          { status: 409 }
        );
      }
      await linkItemsToProperty(ctx, items, propertyId);
      return NextResponse.json({ data: { linked: items.length, propertyId } });
    }

    // ── action === 'create' ──
    const results: Array<{ itemId: string; propertyId: string; created: boolean }> = [];
    const processed = new Set<string>();

    for (const item of items) {
      if (processed.has(item.id)) continue;

      // Idempotency: a committed item never creates a second property.
      if (item.matched_property_id) {
        processed.add(item.id);
        results.push({ itemId: item.id, propertyId: item.matched_property_id, created: false });
        continue;
      }

      // Pull the whole cross-portal duplicate group so one physical
      // property becomes one CRM property with N portal links.
      let group = [item];
      if (item.batch_group) {
        const { data: groupData, error: groupError } = await ctx.supabase
          .from('portal_import_items')
          .select('id, portal, portal_listing_id, listing_url, title, property_type, listing_for, price, bedrooms, area_sqft, locality, city, posted_on, expires_on, portal_status, views, responses, match_status, matched_property_id, batch_group, raw_text')
          .eq('account_id', ctx.accountId)
          .eq('batch_group', item.batch_group)
          .neq('match_status', 'ignored');
        if (groupError) throw groupError;
        group = ((groupData || []) as StagedItem[]).length > 0 ? (groupData as StagedItem[]) : [item];
      }

      const committedSibling = group.find((g) => g.matched_property_id);
      if (committedSibling?.matched_property_id) {
        await linkItemsToProperty(ctx, group.filter((g) => !g.matched_property_id), committedSibling.matched_property_id);
        for (const g of group) {
          processed.add(g.id);
          results.push({ itemId: g.id, propertyId: committedSibling.matched_property_id, created: false });
        }
        continue;
      }

      const gate = await checkPlanLimit(ctx, 'properties');
      if (!gate.allowed) return gateResponse(gate);

      const richest = [...group].sort((a, b) => (b.raw_text?.length || 0) - (a.raw_text?.length || 0))[0];
      const { data: created, error: createError } = await ctx.supabase
        .from('properties')
        .insert({
          account_id: ctx.accountId,
          user_id: ctx.userId,
          title: richest.title || 'Imported portal listing',
          description: richest.raw_text ? `Imported from ${richest.portal}.\n\n${richest.raw_text.slice(0, 2000)}` : null,
          price: richest.listing_for === 'Rent' ? 0 : richest.price || 0,
          rent_per_month: richest.listing_for === 'Rent' ? richest.price : null,
          listing_type: richest.listing_for === 'Rent' ? 'Rent' : 'Sale',
          location: richest.locality || richest.city || 'Unknown',
          sublocality: richest.locality,
          city: richest.city,
          type: richest.property_type || 'Residential',
          status: 'Available',
          bedrooms: richest.bedrooms,
          area_sqft: richest.area_sqft,
          is_published: false,
          listing_source: 'agent',
        })
        .select('id')
        .single();
      if (createError) throw createError;

      await linkItemsToProperty(ctx, group, created.id);
      for (const g of group) {
        processed.add(g.id);
        results.push({ itemId: g.id, propertyId: created.id, created: g.id === item.id });
      }
    }

    return NextResponse.json({ data: { results } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
