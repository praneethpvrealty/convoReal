import { NextResponse } from 'next/server';

import { savePricing } from '@/lib/ai/keys-admin';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';

// PUT /api/admin/ai-keys/pricing
//
// Per-model USD prices per million tokens and the INR rate used for
// estimated spend. Google publishes no balance API, so the panel's
// "remaining" figure is top-ups minus this estimate.
export async function PUT(request: Request) {
  try {
    await requirePlatformAdmin();
    const body = await request.json().catch(() => null);
    const data = await savePricing(supabaseAdmin(), body);
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
