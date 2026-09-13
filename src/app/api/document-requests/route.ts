import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(
        1,
        Number.parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10)
      )
    );
    const { data, error } = await ctx.supabase
      .from('property_document_requests')
      .select(
        'id, property_id, requester_name, requester_phone, requester_email, status, share_sent_at, share_token_expires_at, created_at, updated_at, property:properties(id, title, property_code)'
      )
      .eq('account_id', ctx.accountId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('[GET /api/document-requests]', error);
      return NextResponse.json(
        { error: 'Failed to fetch document requests' },
        { status: 500 }
      );
    }
    const rows = (data ?? []).map((row) => {
      const property = Array.isArray(row.property)
        ? row.property[0]
        : row.property;
      return {
        id: row.id,
        property_id: row.property_id,
        property_title: property?.title || 'Property',
        property_code: property?.property_code || null,
        requester_name: row.requester_name,
        requester_phone: row.requester_phone,
        requester_email: row.requester_email,
        status: row.status,
        share_sent_at: row.share_sent_at,
        share_token_expires_at: row.share_token_expires_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
    return NextResponse.json({ data: rows });
  } catch (error) {
    return toErrorResponse(error);
  }
}
