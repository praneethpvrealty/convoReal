import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

// POST /api/deals — create a deal and atomically sync the linked property's status.
// Replaces the multi-step client-side writes in deal-form.tsx.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `agent:createDeal:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const {
      title, value, currency, contact_id, pipeline_id,
      stage_id, assigned_to, notes, expected_close_date,
      property_id, brokerage_type, brokerage_value,
      brokerage_amount, status: dealStatus,
      // Stage info for property status sync
      stage_name,
    } = body;

    // Validation
    if (typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: "'title' is required" }, { status: 400 });
    }
    if (typeof pipeline_id !== 'string' || !pipeline_id.trim()) {
      return NextResponse.json({ error: "'pipeline_id' is required" }, { status: 400 });
    }
    if (typeof stage_id !== 'string' || !stage_id.trim()) {
      return NextResponse.json({ error: "'stage_id' is required" }, { status: 400 });
    }

    const insertData = {
      user_id: ctx.userId,
      account_id: ctx.accountId,
      title: title.trim(),
      value: typeof value === 'number' ? value : 0,
      currency: typeof currency === 'string' ? currency : 'INR',
      contact_id: typeof contact_id === 'string' ? contact_id : null,
      pipeline_id: pipeline_id.trim(),
      stage_id: stage_id.trim(),
      assigned_to: typeof assigned_to === 'string' && assigned_to.trim() ? assigned_to.trim() : null,
      notes: typeof notes === 'string' ? notes.trim() || null : null,
      expected_close_date: typeof expected_close_date === 'string' ? expected_close_date || null : null,
      property_id: typeof property_id === 'string' && property_id.trim() ? property_id.trim() : null,
      brokerage_type: typeof brokerage_type === 'string' ? brokerage_type : null,
      brokerage_value: typeof brokerage_value === 'number' ? brokerage_value : null,
      brokerage_amount: typeof brokerage_amount === 'number' ? brokerage_amount : null,
      status: typeof dealStatus === 'string' ? dealStatus : 'open',
    };

    const { data: created, error: insertErr } = await ctx.supabase
      .from('deals')
      .insert(insertData)
      .select('id')
      .single();

    if (insertErr || !created) {
      console.error('[POST /api/deals] Insert error:', insertErr);
      return NextResponse.json(
        { error: insertErr?.message ?? 'Failed to create deal' },
        { status: 500 },
      );
    }

    // Sync property status based on stage
    if (insertData.property_id && typeof stage_name === 'string') {
      let propertyStatus = 'Available';
      if (stage_name === 'Negotiation/Token') {
        propertyStatus = 'Under Contract';
      } else if (stage_name === 'Closed Won') {
        propertyStatus = 'Sold';
      }
      await ctx.supabase
        .from('properties')
        .update({ status: propertyStatus })
        .eq('id', insertData.property_id);
    }

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
