import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * Account-level data-sharing consent (DPDP opt-in for the anonymized
 * market-stats aggregation — see src/lib/market/stats-engine.ts).
 *
 * GET  → current consent state (any member; shown read-only to non-owners).
 * POST → { consent: boolean } — OWNER ONLY. Consent is a legal act by the
 *        account owner, stamped with who flipped it and when so the
 *        provenance survives due diligence. Written via the service-role
 *        client after the role check (accounts has no member UPDATE
 *        policy, deliberately).
 */

let _admin: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _admin;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('accounts')
      .select('data_sharing_consent, data_sharing_consent_at')
      .eq('id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      consent: data?.data_sharing_consent ?? false,
      consentAt: data?.data_sharing_consent_at ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('owner');

    const limit = checkRateLimit(
      `data-sharing:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await req.json().catch(() => ({}))) as { consent?: unknown };
    if (typeof body.consent !== 'boolean') {
      return NextResponse.json(
        { error: "'consent' must be a boolean" },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const { error } = await admin()
      .from('accounts')
      .update({
        data_sharing_consent: body.consent,
        // Timestamp/attribution recorded on grant AND withdrawal — the
        // withdrawal moment matters as much for DPDP records.
        data_sharing_consent_at: now,
        data_sharing_consent_by: ctx.userId,
      })
      .eq('id', ctx.accountId);
    if (error) throw error;

    return NextResponse.json({ consent: body.consent, consentAt: now });
  } catch (err) {
    return toErrorResponse(err);
  }
}
