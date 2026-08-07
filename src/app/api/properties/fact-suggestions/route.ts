import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// GET /api/properties/fact-suggestions?property_id=<uuid>
//
// Facts an agent stated in a WhatsApp thread that the listing does not
// carry yet, awaiting a human's confirmation. Scoped to one listing
// when property_id is given (the inventory detail panel), otherwise the
// account's whole open queue.
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const propertyId = new URL(request.url).searchParams.get('property_id');

    let query = ctx.supabase
      .from('property_fact_suggestions')
      .select(
        'id, property_id, contact_id, conversation_id, message_id, field, current_value, suggested_value, evidence, created_at, property:properties(title, property_code), contact:contacts(name, phone)'
      )
      .eq('account_id', ctx.accountId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(100);

    if (propertyId) query = query.eq('property_id', propertyId);

    const { data, error } = await query;

    if (error) {
      console.error(
        '[GET /api/properties/fact-suggestions] select error:',
        error
      );
      return NextResponse.json(
        { error: 'Failed to load suggestions' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
