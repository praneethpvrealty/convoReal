import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';

const MAX_PROPERTY_IDS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdStatus = 'ACTIVE' | 'PAUSED';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');

    const propertyIds = [
      ...new Set(
        (new URL(request.url).searchParams.get('property_ids') ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter((id) => UUID.test(id))
      ),
    ].slice(0, MAX_PROPERTY_IDS);
    if (propertyIds.length === 0) return NextResponse.json({ data: {} });

    const { data, error } = await supabaseAdmin()
      .from('ad_campaigns')
      .select('property_id, status')
      .eq('account_id', ctx.accountId)
      .in('status', ['ACTIVE', 'PAUSED'])
      .in('property_id', propertyIds);

    if (error) {
      console.error('[GET /api/meta-ads/statuses] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load ad statuses' },
        { status: 500 }
      );
    }

    const statuses: Record<string, AdStatus> = {};
    for (const row of data ?? []) {
      if (statuses[row.property_id] !== 'ACTIVE')
        statuses[row.property_id] = row.status as AdStatus;
    }
    return NextResponse.json({ data: statuses });
  } catch (err) {
    return toErrorResponse(err);
  }
}
