import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  countPropertyDocuments,
  DOCUMENT_DECIDED_WINDOW_DAYS,
  type DocumentApprovalRow,
} from '@/lib/dashboard/document-approvals';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const DECIDED_LIMIT = 20;
const SELECT =
  'id, property_id, requester_name, requester_phone, requester_email, status, share_sent_at, share_token_expires_at, created_at, decided_at, property:properties(id, title, property_code, documents)';

interface RequestRow {
  id: string;
  property_id: string;
  requester_name: string;
  requester_phone: string;
  requester_email: string | null;
  status: string;
  share_sent_at: string | null;
  share_token_expires_at: string | null;
  created_at: string;
  decided_at: string | null;
  property:
    | {
        id: string;
        title: string | null;
        property_code: string | null;
        documents: unknown;
      }
    | {
        id: string;
        title: string | null;
        property_code: string | null;
        documents: unknown;
      }[]
    | null;
}

function toApprovalRow(
  row: RequestRow
): DocumentApprovalRow & { share_token_expires_at: string | null } {
  const property = Array.isArray(row.property) ? row.property[0] : row.property;
  return {
    id: row.id,
    property_id: row.property_id,
    property_title: property?.title || 'Property',
    property_code: property?.property_code || null,
    document_count: countPropertyDocuments(property?.documents),
    requester_name: row.requester_name,
    requester_phone: row.requester_phone,
    requester_email: row.requester_email,
    status: row.status,
    share_sent_at: row.share_sent_at,
    share_token_expires_at: row.share_token_expires_at,
    created_at: row.created_at,
    decided_at: row.decided_at,
  };
}

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
    const decidedSince = new Date(
      Date.now() - DOCUMENT_DECIDED_WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const [pending, decided] = await Promise.all([
      ctx.supabase
        .from('property_document_requests')
        .select(SELECT)
        .eq('account_id', ctx.accountId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(limit),
      ctx.supabase
        .from('property_document_requests')
        .select(SELECT)
        .eq('account_id', ctx.accountId)
        .in('status', ['approved', 'rejected'])
        .gte('decided_at', decidedSince)
        .order('decided_at', { ascending: false })
        .limit(Math.min(limit, DECIDED_LIMIT)),
    ]);
    const error = pending.error || decided.error;
    if (error) {
      console.error('[GET /api/document-requests]', error);
      return NextResponse.json(
        { error: 'Failed to fetch document requests' },
        { status: 500 }
      );
    }
    const rows = [
      ...((pending.data ?? []) as unknown as RequestRow[]),
      ...((decided.data ?? []) as unknown as RequestRow[]),
    ].map(toApprovalRow);
    return NextResponse.json({ data: rows });
  } catch (error) {
    return toErrorResponse(error);
  }
}
