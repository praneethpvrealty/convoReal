import { NextResponse } from 'next/server';

import {
  KeyInputError,
  createManagedKey,
  loadKeyDashboard,
} from '@/lib/ai/keys-admin';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

// GET /api/admin/ai-keys?days=30
//
// Managed Gemini keys with their status, usage and estimated spend. Key
// material never leaves the server: rows carry a four-character hint only.
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin();
    const days = Math.min(
      90,
      Math.max(7, Number(new URL(request.url).searchParams.get('days')) || 30)
    );
    const data = await loadKeyDashboard(supabaseAdmin(), days);
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/admin/ai-keys
export async function POST(request: Request) {
  try {
    const { userId } = await requirePlatformAdmin();
    const limit = await checkRateLimit(
      `aiKeys:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    try {
      const data = await createManagedKey(supabaseAdmin(), body, userId);
      return NextResponse.json({ data }, { status: 201 });
    } catch (err) {
      if (err instanceof KeyInputError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
