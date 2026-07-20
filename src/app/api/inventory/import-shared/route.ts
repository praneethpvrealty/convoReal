import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';
import { findOrCreateContact } from '@/lib/contacts/find-or-create';

/**
 * POST /api/inventory/import-shared
 *
 * Imports a co-broker-shared property (the ?property_id=...&mode=view
 * link another brokerage sent on WhatsApp) into the caller's own
 * inventory, preserving cross-account lineage:
 *   - source_property_id → the upstream listing, so the ORIGINAL source
 *     agent's digest can count buyers this copy reaches as indirect.
 *   - owner_contact_id → the sharing brokerage, find-or-created as an
 *     Agent contact (listing_source 'agent'), so the sharer gets their
 *     own reach digest from this account.
 *
 * Only fields the public co-broker showcase already exposes are copied
 * — internal notes, deal remarks, documents, floor tenancies, and deal
 * mode stay behind. The copy lands unpublished for review. Idempotent:
 * re-importing the same source returns the existing copy.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COPIED_COLUMNS =
  'id, account_id, title, description, price, listing_type, rent_per_month, maintenance, advance, gst, ' +
  'jv_structure, owner_share_percent, builder_share_percent, goodwill_amount, ' +
  'bts_lease_years, bts_lock_in_years, bts_escalation_percent, ' +
  'location, type, bedrooms, bathrooms, area_sqft, area_unit, land_area, land_area_unit, ' +
  'super_built_area, sublocality, city, state, project, land_zone, ideal_for, dimensions, ' +
  'road_width, road_width_unit, facing_direction, nearby_highlights, features, images, ' +
  'google_map_link, latitude, longitude, locality_place_id, locality_canonical, is_published';

function extractPropertyId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (UUID_RE.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const fromQuery = url.searchParams.get('property_id');
    if (fromQuery && UUID_RE.test(fromQuery)) return fromQuery;
  } catch {
    return null;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `agent:importSharedProperty:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const gate = await checkPlanLimit(ctx, 'properties');
    if (!gate.allowed) return gateResponse(gate);

    const body = await request.json().catch(() => null);
    const sourceId = extractPropertyId(body?.url ?? body?.property_id);
    if (!sourceId) {
      return NextResponse.json(
        { error: 'Paste a shared property link or property id' },
        { status: 400 }
      );
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: sourceRow } = await admin
      .from('properties')
      .select(COPIED_COLUMNS)
      .eq('id', sourceId)
      .maybeSingle();
    const source = sourceRow as Record<string, unknown> | null;
    // Only published listings are reachable via share links — an
    // unpublished id would let arbitrary UUIDs probe private inventory.
    if (!source || !source.is_published) {
      return NextResponse.json({ error: 'Shared property not found' }, { status: 404 });
    }
    if (source.account_id === ctx.accountId) {
      return NextResponse.json(
        { error: 'This property is already in your inventory' },
        { status: 409 }
      );
    }

    const { data: existing } = await ctx.supabase
      .from('properties')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('source_property_id', source.id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ data: { id: existing.id, alreadyImported: true } });
    }

    // The sharing brokerage becomes an Agent contact in the importer's
    // book — the same card a manual agent-referred listing would use.
    const [{ data: sourceAccount }, { data: sharerProfiles }] = await Promise.all([
      admin.from('accounts').select('name').eq('id', source.account_id).maybeSingle(),
      admin
        .from('profiles')
        .select('full_name, phone, org_role')
        .eq('account_id', source.account_id)
        .not('phone', 'is', null)
        .limit(10),
    ]);
    const sharer =
      (sharerProfiles || []).find((p) => p.org_role === 'org_manager') ||
      (sharerProfiles || [])[0] ||
      null;

    let sharerContactId: string | null = null;
    if (sharer?.phone) {
      const result = await findOrCreateContact(admin, {
        accountId: ctx.accountId,
        userId: ctx.userId,
        phone: sharer.phone,
        name: sharer.full_name || sourceAccount?.name || null,
        company: sourceAccount?.name || null,
        source: 'Shared Inventory',
        classification: 'Agent',
      });
      sharerContactId = result.contactId;
    }

    const copied = { ...source };
    delete copied.id;
    delete copied.account_id;
    delete copied.is_published;
    const { data: created, error: insertError } = await ctx.supabase
      .from('properties')
      .insert({
        ...copied,
        account_id: ctx.accountId,
        user_id: ctx.userId,
        status: 'Available',
        is_published: false,
        listing_source: 'agent',
        owner_contact_id: sharerContactId,
        source_property_id: source.id,
      })
      .select('id, title')
      .single();

    if (insertError || !created) {
      console.error('[POST /api/inventory/import-shared] Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to import property' }, { status: 500 });
    }

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
