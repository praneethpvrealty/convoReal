import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  computeExtendedUntil,
  effectivePeriodEnd,
  hashExtensionPayload,
  hashRevokePayload,
  parseExtensionRequest,
  parseRevokeRequest,
} from '@/lib/billing/admin-extension';
import {
  issueExtensionChallenge,
  requireSuperAdmin,
} from '@/lib/billing/admin-extension-server';

/**
 * POST /api/admin/subscription-extensions/challenge
 *
 * Step 1 of granting (or revoking) a subscription extension: issues a
 * 6-digit WhatsApp OTP to the ACTING ADMIN's own registered phone.
 *
 * The challenge is bound to a hash of the exact request, so the code it
 * returns can only ever apply THIS change — see hashExtensionPayload in
 * src/lib/billing/admin-extension.ts. The response also carries a
 * preview of what will happen to each account, so the admin confirms
 * against real dates rather than trusting the form.
 *
 * Body (grant):  { action?: 'grant', accountIds, days, reason, note?, incidentRef? }
 * Body (revoke): { action: 'revoke', extensionIds? | incidentRef?, reason? }
 * Protected by super_admin role.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const admin = supabaseAdmin();
    const auth = await requireSuperAdmin(supabase, admin);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limit = await checkRateLimit(
      `admin:extension-otp:${auth.userId}`,
      RATE_LIMITS.adminOtp
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const isRevoke = (body as { action?: string } | null)?.action === 'revoke';

    if (isRevoke) {
      const parsedRevoke = parseRevokeRequest(body);
      if (!parsedRevoke.ok) {
        return NextResponse.json(
          { error: parsedRevoke.error },
          { status: 400 }
        );
      }

      const query = admin
        .from('subscription_extensions')
        .select('id, account_id, days, extended_until')
        .is('revoked_at', null);

      const { data: targets } = parsedRevoke.value.incidentRef
        ? await query.eq('incident_ref', parsedRevoke.value.incidentRef)
        : await query.in('id', parsedRevoke.value.extensionIds);

      const rows = (targets ?? []) as {
        id: string;
        account_id: string;
        days: number;
      }[];
      if (rows.length === 0) {
        return NextResponse.json(
          { error: 'No active extensions match that selection' },
          { status: 404 }
        );
      }

      const issued = await issueExtensionChallenge({
        admin,
        adminUserId: auth.userId,
        adminPhone: auth.phone,
        action: 'extension_revoke',
        payloadHash: hashRevokePayload(parsedRevoke.value),
        accountId: null,
      });
      if (!issued.ok) {
        return NextResponse.json(
          { error: issued.error },
          { status: issued.status }
        );
      }

      console.log(
        `[admin/subscription-extensions/challenge] revoke OTP issued for ${rows.length} extension(s) by admin ${auth.userId}`
      );

      return NextResponse.json({
        challengeId: issued.challengeId,
        expiresAt: issued.expiresAt,
        preview: {
          action: 'revoke',
          affectedCount: rows.length,
          totalDays: rows.reduce((sum, r) => sum + r.days, 0),
        },
      });
    }

    const parsedGrant = parseExtensionRequest(body);
    if (!parsedGrant.ok) {
      return NextResponse.json({ error: parsedGrant.error }, { status: 400 });
    }
    const req = parsedGrant.value;

    const { data: accountRows } = await admin
      .from('accounts')
      .select('id, name, status')
      .in('id', req.accountIds);

    const accounts = (accountRows ?? []) as {
      id: string;
      name: string | null;
      status: string;
    }[];

    // Fail closed on an unknown id rather than silently crediting the
    // subset that happens to exist — the admin should see the mismatch
    // before a code is ever sent.
    if (accounts.length !== req.accountIds.length) {
      const found = new Set(accounts.map((a) => a.id));
      return NextResponse.json(
        {
          error: 'Some accounts were not found',
          missing: req.accountIds.filter((id) => !found.has(id)),
        },
        { status: 404 }
      );
    }

    const { data: subRows } = await admin
      .from('subscriptions')
      .select('account_id, plan, current_period_end')
      .in('account_id', req.accountIds);

    const subs = new Map(
      (
        (subRows ?? []) as {
          account_id: string;
          plan: string;
          current_period_end: string | null;
        }[]
      ).map((s) => [s.account_id, s])
    );

    const nowMs = Date.now();
    const preview = accounts.map((account) => {
      const sub = subs.get(account.id);
      const currentPeriodEnd = sub?.current_period_end ?? null;
      const extendedUntil = computeExtendedUntil(
        currentPeriodEnd,
        req.days,
        nowMs
      );
      return {
        accountId: account.id,
        name: account.name,
        status: account.status,
        plan: sub?.plan ?? 'starter',
        currentPeriodEnd,
        newPeriodEnd: effectivePeriodEnd(currentPeriodEnd, extendedUntil),
      };
    });

    const issued = await issueExtensionChallenge({
      admin,
      adminUserId: auth.userId,
      adminPhone: auth.phone,
      action: 'extension_grant',
      payloadHash: hashExtensionPayload(req),
      accountId: req.accountIds.length === 1 ? req.accountIds[0] : null,
    });
    if (!issued.ok) {
      return NextResponse.json(
        { error: issued.error },
        { status: issued.status }
      );
    }

    console.log(
      `[admin/subscription-extensions/challenge] grant OTP issued for ${req.accountIds.length} account(s), ${req.days}d, reason=${req.reason}, incident=${req.incidentRef ?? '-'} by admin ${auth.userId}`
    );

    return NextResponse.json({
      challengeId: issued.challengeId,
      expiresAt: issued.expiresAt,
      preview: { action: 'grant', days: req.days, accounts: preview },
    });
  } catch (error) {
    console.error('[admin/subscription-extensions/challenge] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
