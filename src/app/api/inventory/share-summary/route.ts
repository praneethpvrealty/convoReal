import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  buildInventorySummary,
  categoryForType,
} from '@/lib/inventory-summary-builder';
import { rankInventoryProperties } from '@/lib/inventory/top-properties';
import { attachInquiredListingTypes } from '@/lib/contacts/inquired-intent';
import { MATCHING_CONTACT_COLUMNS } from '@/lib/v1/projections';
import { buildInventoryUpdateParams } from '@/lib/whatsapp/inventory-update-template';
import {
  filterPropertiesBySearch,
  selectPinnedProperties,
} from '@/lib/inventory/search-filter';
import type {
  ShareCategory,
  ShareScope,
} from '@/lib/inventory/showcase-share-link';
import type { Contact, Property } from '@/types';

const CATEGORIES: ShareCategory[] = [
  'All',
  'Residential',
  'Commercial',
  'Agricultural',
];

function withVisitor(urlValue: string, contactId: string): string {
  if (!urlValue) return '';
  try {
    const url = new URL(urlValue);
    url.searchParams.set('v', contactId);
    return url.toString();
  } catch {
    return urlValue;
  }
}

// GET /api/inventory/share-summary?scope=&category=&search=&ids=&portal_url=&contact_ids=
//
// The WhatsApp-ready digest of the listings one share link opens, plus
// the three body parameters the inventory_update template renders from
// the same set,
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
    const contactIds = [
      ...new Set(
        (params.get('contact_ids') || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      ),
    ].slice(0, 25);

    const { data, error } = await ctx.supabase
      .from('properties')
      .select(
        'id, title, type, listing_type, price, price_per_sqft, rent_per_month, rental_income, roi, area_sqft, area_unit, land_area, land_area_unit, bedrooms, location, sublocality, city, project, property_code, listing_source, latitude, longitude, tags, is_starred, images, video_url, description, features, nearby_highlights, google_map_link, created_at, updated_at'
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

    const preserveOrder = scope === 'pick';
    const shareProperties =
      scope === 'all' && category !== 'All'
        ? scoped.filter(
            (property) => categoryForType(property.type) === category
          )
        : scoped;
    const personalized: Record<
      string,
      {
        summary: string;
        template_params: [string, string, string];
        match_count: number;
      }
    > = {};

    if (contactIds.length > 0 && !preserveOrder) {
      const [contactResult, feedbackResult] = await Promise.all([
        ctx.supabase
          .from('contacts')
          .select(`${MATCHING_CONTACT_COLUMNS}, last_inquired_property_id`)
          .eq('account_id', ctx.accountId)
          .eq('status', 'active')
          .in('id', contactIds),
        ctx.supabase
          .from('listing_feedback')
          .select('contact_id, property_id')
          .eq('account_id', ctx.accountId)
          .in('contact_id', contactIds)
          .eq('verdict', 'rejected'),
      ]);

      if (contactResult.error) {
        console.error(
          '[GET /api/inventory/share-summary] contact query error:',
          contactResult.error
        );
      } else {
        const contacts = await attachInquiredListingTypes(
          ctx.supabase,
          ctx.accountId,
          (contactResult.data ?? []) as unknown as Contact[]
        );
        const rejectedByContact = new Map<string, Set<string>>();
        if (feedbackResult.error) {
          console.error(
            '[GET /api/inventory/share-summary] feedback query error:',
            feedbackResult.error
          );
        } else {
          for (const row of feedbackResult.data ?? []) {
            const rejected = rejectedByContact.get(row.contact_id) ?? new Set();
            rejected.add(row.property_id);
            rejectedByContact.set(row.contact_id, rejected);
          }
        }

        for (const contact of contacts) {
          const rejected = rejectedByContact.get(contact.id);
          const eligible = rejected
            ? shareProperties.filter((property) => !rejected.has(property.id))
            : shareProperties;
          const recipientPortalUrl = withVisitor(portalUrl, contact.id);
          personalized[contact.id] = {
            summary: buildInventorySummary(eligible, {
              portalUrl: recipientPortalUrl,
              contact,
              recipientName: contact.name,
            }),
            template_params: buildInventoryUpdateParams(eligible, contact),
            match_count: rankInventoryProperties(eligible, contact).matchCount,
          };
        }
      }
    }

    return NextResponse.json({
      data: {
        summary: buildInventorySummary(shareProperties, {
          portalUrl,
          preserveOrder,
        }),
        count: shareProperties.length,
        // Body params {{2}}..{{4}} of the inventory_update template, so a
        // surface that cannot import the builder can still send it.
        template_params: buildInventoryUpdateParams(shareProperties, null, {
          preserveOrder,
        }),
        personalized,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
