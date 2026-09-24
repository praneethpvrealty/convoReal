import { NextResponse } from 'next/server';

import { probeGeminiKey } from '@/lib/ai/gemini';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/whatsapp/encryption';

// POST /api/admin/ai-keys/[id]/test
//
// One tiny generation on the lite model with this key alone. A pass clears
// the key's resting state; a failure is recorded but does not rest it.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requirePlatformAdmin();
    const limit = await checkRateLimit(
      `aiKeyTest:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const { id } = await params;
    const db = supabaseAdmin();
    const { data: row, error } = await db
      .from('ai_provider_keys')
      .select('id, key_ciphertext')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    }
    const startedAt = Date.now();
    try {
      await probeGeminiKey(decrypt(row.key_ciphertext as string));
      await db
        .from('ai_provider_keys')
        .update({
          resting_until: null,
          last_error: null,
          last_error_at: null,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', id);
      return NextResponse.json({
        data: { ok: true, latency_ms: Date.now() - startedAt },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .from('ai_provider_keys')
        .update({
          last_error: message.slice(0, 500),
          last_error_at: new Date().toISOString(),
        })
        .eq('id', id);
      return NextResponse.json({ data: { ok: false, error: message } });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
