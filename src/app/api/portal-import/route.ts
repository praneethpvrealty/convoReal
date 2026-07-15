// ============================================================
// POST /api/portal-import — stage a harvest batch and match it.
//
// The Chrome extension scrapes the agent's own portal dashboard
// and the CRM page forwards the payload here (the user's own
// authenticated session — no service-role, RLS applies).
//
// Idempotent by construction: staged items upsert on
// (account_id, portal, portal_listing_id), so re-running a sync
// updates rows in place. Items already committed to a property
// (matched_property_id set) refresh that property's portal link
// instead of re-entering the review queue — a listing can never
// produce a second CRM property.
//
// GET /api/portal-import — pending review/new items + portal
// account stats for the sync dialog.
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { PORTAL_KEYS, type PortalKey } from '@/lib/portals/post-kit';
import { parseHarvestedListing } from '@/lib/portal-import/listing-parser';
import {
  groupCrossPortalDuplicates,
  matchListing,
  type ExistingPortalLink,
} from '@/lib/portal-import/listing-matcher';
import type { HarvestedListing, HarvestPayload, ParsedListing } from '@/lib/portal-import/types';
import type { Property } from '@/types';

const MAX_BATCH = 300;
const IMPORT_RATE = { limit: 10, windowMs: 60_000 };

function isPortalKey(v: unknown): v is PortalKey {
  return typeof v === 'string' && (PORTAL_KEYS as string[]).includes(v);
}

function portalRowStatus(parsed: ParsedListing): 'active' | 'expired' | 'removed' {
  if (parsed.portalStatus === 'expired') return 'expired';
  if (parsed.portalStatus === 'inactive') return 'removed';
  return 'active';
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const rate = checkRateLimit(`portal-import:${ctx.userId}`, IMPORT_RATE);
    if (!rate.success) return rateLimitResponse(rate);

    const body = (await request.json()) as Partial<HarvestPayload>;
    if (!isPortalKey(body.portal) || !Array.isArray(body.listings)) {
      return NextResponse.json({ error: 'portal and listings are required' }, { status: 400 });
    }
    if (body.listings.length === 0) {
      return NextResponse.json({ error: 'No listings in the harvest payload' }, { status: 400 });
    }
    if (body.listings.length > MAX_BATCH) {
      return NextResponse.json({ error: `Batch too large (max ${MAX_BATCH})` }, { status: 400 });
    }
    const portal = body.portal;

    const rawListings = body.listings.filter(
      (l): l is HarvestedListing => !!l && typeof l.listingId === 'string' && l.listingId.length > 0 && typeof l.rawText === 'string'
    );

    // In-batch dedup: the dashboard can render the same card twice
    // (sticky rows, pagination overlap) — last occurrence wins.
    const byListingId = new Map<string, HarvestedListing>();
    for (const raw of rawListings) byListingId.set(raw.listingId, raw);
    const parsed = [...byListingId.values()].map((raw) => parseHarvestedListing(portal, raw));

    const [{ data: propertiesData, error: propError }, { data: linksData, error: linkError }, { data: stagedData, error: stagedError }] =
      await Promise.all([
        ctx.supabase
          .from('properties')
          .select('*')
          .eq('account_id', ctx.accountId)
          .neq('status', 'Archived'),
        ctx.supabase
          .from('property_portal_listings')
          .select('property_id, portal, portal_listing_id, listing_url')
          .eq('account_id', ctx.accountId),
        ctx.supabase
          .from('portal_import_items')
          .select('portal, portal_listing_id, matched_property_id, match_status')
          .eq('account_id', ctx.accountId),
      ]);
    if (propError || linkError || stagedError) {
      throw propError || linkError || stagedError;
    }

    const properties = (propertiesData || []) as Property[];
    const links = (linksData || []) as ExistingPortalLink[];
    const committedByKey = new Map<string, string>();
    for (const row of stagedData || []) {
      if (row.matched_property_id && (row.match_status === 'imported' || row.match_status === 'linked' || row.match_status === 'auto_matched')) {
        committedByKey.set(`${row.portal}:${row.portal_listing_id}`, row.matched_property_id);
      }
    }

    const groups = groupCrossPortalDuplicates(
      parsed.map((p) => ({ key: `${p.portal}:${p.portalListingId}`, parsed: p }))
    );

    const summary = { linked: 0, auto_matched: 0, review: 0, new: 0 };
    const rows = parsed.map((p) => {
      const key = `${p.portal}:${p.portalListingId}`;
      const committedPropertyId = committedByKey.get(key) || null;
      const match = committedPropertyId
        ? { bucket: 'linked' as const, propertyId: committedPropertyId, confidence: 1, reasons: ['already imported in a previous sync'], candidates: [] }
        : matchListing(p, properties, links);
      summary[match.bucket]++;

      return {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        portal: p.portal,
        portal_listing_id: p.portalListingId,
        listing_url: p.listingUrl,
        raw_text: p.rawText.slice(0, 8000),
        title: p.title.slice(0, 300),
        property_type: p.propertyType,
        listing_for: p.listingFor,
        price: p.price,
        bedrooms: p.bedrooms,
        area_sqft: p.areaSqft,
        locality: p.locality,
        city: p.city,
        posted_on: p.postedOn,
        expires_on: p.expiresOn,
        portal_status: p.portalStatus,
        views: p.views,
        responses: p.responses,
        match_status: match.bucket,
        matched_property_id: match.bucket === 'linked' || match.bucket === 'auto_matched' ? match.propertyId : null,
        match_confidence: match.confidence,
        match_reasons: match.reasons,
        match_candidates: match.candidates.map((c) => {
          const prop = properties.find((x) => x.id === c.propertyId);
          return { ...c, title: prop?.title || '', location: prop?.sublocality || prop?.location || '' };
        }),
        batch_group: groups.get(key) || null,
      };
    });

    const { data: staged, error: upsertError } = await ctx.supabase
      .from('portal_import_items')
      .upsert(rows, { onConflict: 'account_id,portal,portal_listing_id' })
      .select('id, portal, portal_listing_id, listing_url, title, property_type, listing_for, price, bedrooms, area_sqft, locality, city, posted_on, expires_on, portal_status, views, responses, match_status, matched_property_id, match_confidence, match_reasons, match_candidates, batch_group');
    if (upsertError) throw upsertError;

    // Linked / auto-matched items refresh the existing portal link in
    // place. onConflict portal identity — the partial unique index —
    // makes a second property link for the same listing impossible.
    const linkRefresh = (staged || [])
      .filter((row) => row.matched_property_id)
      .map((row) => {
        const p = parsed.find((x) => x.portalListingId === row.portal_listing_id);
        return {
          account_id: ctx.accountId,
          property_id: row.matched_property_id as string,
          user_id: ctx.userId,
          portal,
          portal_listing_id: row.portal_listing_id,
          listing_url: row.listing_url,
          expires_on: row.expires_on,
          status: p ? portalRowStatus(p) : 'active',
          views: row.views,
          responses: row.responses,
          last_synced_at: new Date().toISOString(),
        };
      });
    if (linkRefresh.length > 0) {
      const { error: linkUpsertError } = await ctx.supabase
        .from('property_portal_listings')
        .upsert(linkRefresh, { onConflict: 'property_id,portal' });
      if (linkUpsertError) throw linkUpsertError;
    }

    if (body.accountStats && typeof body.accountStats === 'object') {
      const s = body.accountStats;
      const { error: statsError } = await ctx.supabase.from('portal_accounts').upsert(
        {
          account_id: ctx.accountId,
          portal,
          remaining_listings: typeof s.remainingListings === 'number' ? s.remainingListings : null,
          remaining_refreshes: typeof s.remainingRefreshes === 'number' ? s.remainingRefreshes : null,
          plan_name: typeof s.planName === 'string' ? s.planName.slice(0, 120) : null,
          plan_expires_on: typeof s.planExpiresOn === 'string' ? s.planExpiresOn : null,
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,portal' }
      );
      if (statsError) throw statsError;
    }

    return NextResponse.json({ data: { items: staged || [], summary } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const [{ data: items, error: itemsError }, { data: portalAccounts, error: accountsError }] = await Promise.all([
      ctx.supabase
        .from('portal_import_items')
        .select('id, portal, portal_listing_id, listing_url, title, property_type, listing_for, price, bedrooms, area_sqft, locality, city, posted_on, expires_on, portal_status, views, responses, match_status, matched_property_id, match_confidence, match_reasons, match_candidates, batch_group, updated_at')
        .eq('account_id', ctx.accountId)
        .in('match_status', ['review', 'new'])
        .order('updated_at', { ascending: false }),
      ctx.supabase
        .from('portal_accounts')
        .select('portal, remaining_listings, remaining_refreshes, plan_name, plan_expires_on, synced_at')
        .eq('account_id', ctx.accountId),
    ]);
    if (itemsError || accountsError) throw itemsError || accountsError;
    return NextResponse.json({ data: { items: items || [], portalAccounts: portalAccounts || [] } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
