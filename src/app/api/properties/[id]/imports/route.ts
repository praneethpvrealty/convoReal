import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  inventoryImportStatus,
  type InventoryImportsResponse,
} from '@/lib/inventory/import-activity';

const PAGE_SIZE = 20;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ImportRow {
  id: string;
  account_id: string;
  user_id: string;
  created_at: string;
  status: string;
  recipient: { name: string; status: string };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;
    const pageText = new URL(request.url).searchParams.get('page') ?? '1';
    const page = Number(pageText);
    if (
      !UUID_RE.test(id) ||
      !/^\d+$/.test(pageText) ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 10_000
    ) {
      return NextResponse.json(
        { error: 'Invalid property or page' },
        { status: 400 }
      );
    }

    const { data: source, error: sourceError } = await ctx.supabase
      .from('properties')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source)
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );

    const admin = supabaseAdmin();
    const start = (page - 1) * PAGE_SIZE;
    const { data, error } = await admin
      .from('properties')
      .select(
        'id, account_id, user_id, created_at, status, recipient:accounts!properties_account_id_fkey!inner(name, status)'
      )
      .eq('source_property_id', source.id)
      .neq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + PAGE_SIZE);
    if (error) throw error;
    const rows = (data ?? []) as unknown as ImportRow[];
    const visible = rows.slice(0, PAGE_SIZE);
    const profiles = visible.length
      ? await admin
          .from('profiles')
          .select('user_id, account_id, full_name')
          .in('user_id', [...new Set(visible.map((row) => row.user_id))])
          .in('account_id', [...new Set(visible.map((row) => row.account_id))])
      : { data: [], error: null };
    if (profiles.error) throw profiles.error;

    const response: InventoryImportsResponse = {
      data: visible.map((row) => ({
        id: row.id,
        agencyName: row.recipient.name || 'Agency',
        agentName:
          profiles.data?.find(
            (profile) =>
              profile.user_id === row.user_id &&
              profile.account_id === row.account_id
          )?.full_name || null,
        recordedAt: row.created_at,
        status: inventoryImportStatus(row.status, row.recipient.status),
      })),
      nextPage: rows.length > PAGE_SIZE ? page + 1 : null,
    };
    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
