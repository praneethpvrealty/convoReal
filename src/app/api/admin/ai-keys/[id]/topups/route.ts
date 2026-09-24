import { NextResponse } from 'next/server';

import { KeyInputError, validateTopup } from '@/lib/ai/keys-admin';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';

// POST /api/admin/ai-keys/[id]/topups
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    let topup: ReturnType<typeof validateTopup>;
    try {
      topup = validateTopup(body);
    } catch (err) {
      if (err instanceof KeyInputError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    const { data, error } = await supabaseAdmin()
      .from('ai_key_topups')
      .insert({ ...topup, key_id: id, created_by: userId })
      .select('id, key_id, amount, currency, topped_up_at, note')
      .single();
    if (error) {
      if (error.code === '23503') {
        return NextResponse.json({ error: 'Key not found' }, { status: 404 });
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
