import { NextResponse } from 'next/server';

import { setCallLogging } from '@/lib/ai/keys-admin';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';

// PUT /api/admin/ai-keys/logging
export async function PUT(request: Request) {
  try {
    await requirePlatformAdmin();
    const body = await request.json().catch(() => null);
    if (typeof body?.enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be true or false' },
        { status: 400 }
      );
    }
    await setCallLogging(supabaseAdmin(), body.enabled);
    return NextResponse.json({ data: { enabled: body.enabled } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
