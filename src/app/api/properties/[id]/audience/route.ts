import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { fetchListingAudience } from '@/lib/inventory/listing-audience';

// GET /api/properties/[id]/audience
// The contacts who engaged with one listing — enquiries and identified
// showcase views, one row each. Shares the aggregation with the web
// share dialog so both surfaces select the same people.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id: propertyId } = await params;

    const { data: property, error: propertyError } = await ctx.supabase
      .from('properties')
      .select('id')
      .eq('id', propertyId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (propertyError) {
      console.error('[GET /api/properties/[id]/audience]', propertyError);
      return NextResponse.json(
        { error: 'Failed to load property' },
        { status: 500 }
      );
    }
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }

    const audience = await fetchListingAudience(
      ctx.supabase,
      ctx.accountId,
      propertyId
    );
    return NextResponse.json({ data: audience });
  } catch (err) {
    return toErrorResponse(err);
  }
}
