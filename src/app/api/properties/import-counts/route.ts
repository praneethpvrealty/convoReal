import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { toImportCountMap } from '@/lib/inventory/import-activity';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase.rpc('inventory_import_counts', {
      target_account_id: ctx.accountId,
    });
    if (error) {
      console.error('[GET /api/properties/import-counts] RPC error:', error);
      return NextResponse.json(
        { error: 'Failed to load import counts' },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { data: toImportCountMap(data) },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
