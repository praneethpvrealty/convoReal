import { NextResponse } from 'next/server';

import {
  KEY_COLUMNS,
  KeyInputError,
  validateKeyPatch,
} from '@/lib/ai/keys-admin';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';

// PATCH /api/admin/ai-keys/[id]
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    let patch: Record<string, unknown>;
    try {
      patch = validateKeyPatch(body);
    } catch (err) {
      if (err instanceof KeyInputError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    const { data, error } = await supabaseAdmin()
      .from('ai_provider_keys')
      .update(patch)
      .eq('id', id)
      .select(KEY_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A key with that label already exists.' },
          { status: 400 }
        );
      }
      throw new Error(error.message);
    }
    if (!data) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/admin/ai-keys/[id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const { error } = await supabaseAdmin()
      .from('ai_provider_keys')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: { id } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
