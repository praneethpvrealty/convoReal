import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { buildInventorySummary } from '@/lib/inventory-summary-builder';
import {
  filterPropertiesBySearch,
  selectPinnedProperties,
} from '@/lib/inventory/search-filter';
import type { ShareCategory, ShareScope } from '@/lib/inventory/showcase-share-link';
import type { Property } from '@/types';

const CATEGORIES: ShareCategory[] = [
  'All',
  'Residential',
  'Commercial',
  'Agricultural',
];

// GET /api/inventory/share-summary?scope=&category=&search=&ids=&portal_url=
//
// The WhatsApp-ready digest of the listings one share link opens,
// grouped by category with price, size, rent and ROI. The scope rules
// are the same pure modules the web dialog builds its preview from
// (AGENTS.md §2.8): the phone gets the digest by calling this rather
// than by carrying a second copy of the builder that could drift.
//
// Caller's RLS client — the account is taken from the session, never
// from a parameter.
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const params = new URL(request.url).searchParams;

    const scope = (params.get('scope') || 'all') as ShareScope;
    const categoryParam = params.get('category') || 'All';
    const category = (
      CATEGORIES.includes(categoryParam as ShareCategory)
        ? categoryParam
        : 'All'
    ) as ShareCategory;
    const search = params.get('search')?.trim() || '';
    const ids = (params.get('ids') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const portalUrl = params.get('portal_url') || '';

    const { data, error } = await ctx.supabase
      .from('properties')
      .select(
        'id, title, type, listing_type, price, rent_per_month, rental_income, roi, area_sqft, area_unit, land_area, land_area_unit, bedrooms, location, sublocality, city, project, property_code, listing_source'
      )
      .eq('account_id', ctx.accountId)
      .eq('is_published', true)
      .eq('status', 'Available')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/inventory/share-summary] query error:', error);
      return NextResponse.json(
        { error: 'Failed to load listings' },
        { status: 500 }
      );
    }

    const published = (data ?? []) as unknown as Property[];
    const scoped =
      scope === 'search'
        ? filterPropertiesBySearch(published, search)
        : scope === 'pick'
          ? // An empty pick is an empty share, not the whole catalog —
            // selectPinnedProperties passes everything through for no keys.
            ids.length > 0
            ? selectPinnedProperties(published, ids)
            : []
          : published;

    return NextResponse.json({
      data: {
        summary: buildInventorySummary(scoped, {
          portalUrl,
          category: scope === 'all' ? category : 'All',
        }),
        count: scoped.length,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
