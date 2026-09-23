import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';

// DELETE /api/guidance-value/saved/[id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from('property_guidance_values')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ data: { id } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
