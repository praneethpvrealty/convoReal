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
  parseExtensionRequest,
} from '@/lib/billing/admin-extension';
import {
  consumeExtensionChallenge,
  requireSuperAdmin,
} from '@/lib/billing/admin-extension-server';
import { notifyExtensionGranted } from '@/lib/billing/extension-notifier';

const LIST_LIMIT = 100;

/**
 * GET /api/admin/subscription-extensions?incidentRef=&accountId=
 *
 * Audit view of granted service credit, newest first.
 * Protected by super_admin role.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const admin = supabaseAdmin();
    const auth = await requireSuperAdmin(supabase, admin);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const url = new URL(request.url);
    const incidentRef = url.searchParams.get('incidentRef');
    const accountId = url.searchParams.get('accountId');

    let query = admin
      .from('subscription_extensions')
      .select(
        'id, account_id, days, extended_until, period_end_before, reason, note, customer_message, incident_ref, granted_by_email, notified_at, notification_result, revoked_at, revoke_reason, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT);

    if (incidentRef) query = query.eq('incident_ref', incidentRef);
    if (accountId) query = query.eq('account_id', accountId);

    const { data, error } = await query;
    if (error) {
      console.error('[admin/subscription-extensions] list failed:', error);
      return NextResponse.json(
        { error: 'Failed to load extensions' },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as { account_id: string }[];
    // Name lookup is bounded by LIST_LIMIT rows, so the id list passed
    // to .in() can never grow with account activity.
    const accountIds = [...new Set(rows.map((r) => r.account_id))];
    const { data: accountRows } = accountIds.length
      ? await admin.from('accounts').select('id, name').in('id', accountIds)
      : { data: [] };

    const names = new Map(
      ((accountRows ?? []) as { id: string; name: string | null }[]).map(
        (a) => [a.id, a.name]
      )
    );

    return NextResponse.json({
      extensions: rows.map((row) => ({
        ...row,
        account_name: names.get(row.account_id) ?? null,
      })),
    });
  } catch (error) {
    console.error('[admin/subscription-extensions] GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/subscription-extensions
 *
 * Step 2 of the extension flow: verifies the OTP issued by
 * .../challenge and, on success, writes one service-credit row per
 * account. This adds paid days without any payment, which is why it
 * carries the same step-up as the plan override.
 *
 * The full request is re-parsed and re-hashed here and compared against
 * the hash the challenge was minted with, so the applied change is
 * provably the one the admin was shown and approved.
 *
 * Body: { challengeId, code, accountIds, days, reason, note?, incidentRef? }
 * Protected by super_admin role + WhatsApp OTP step-up.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const admin = supabaseAdmin();
    const auth = await requireSuperAdmin(supabase, admin);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const limit = checkRateLimit(
      `admin:extension-otp:${auth.userId}`,
      RATE_LIMITS.adminOtp
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const { challengeId, code } = (body ?? {}) as {
      challengeId?: string;
      code?: string;
    };

    if (!challengeId || !code) {
      return NextResponse.json(
        { error: 'challengeId and code are required' },
        { status: 400 }
      );
    }

    const parsed = parseExtensionRequest(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const req = parsed.value;

    const consumed = await consumeExtensionChallenge({
      admin,
      challengeId,
      code,
      adminUserId: auth.userId,
      action: 'extension_grant',
      payloadHash: hashExtensionPayload(req),
    });

    if (!consumed.ok) {
      return NextResponse.json(
        { error: 'Verification failed', reason: consumed.reason },
        { status: consumed.status }
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
    const grants = req.accountIds.map((accountId) => {
      const currentPeriodEnd = subs.get(accountId)?.current_period_end ?? null;
      return {
        account_id: accountId,
        days: req.days,
        extended_until: computeExtendedUntil(currentPeriodEnd, req.days, nowMs),
        period_end_before: currentPeriodEnd,
        reason: req.reason,
        note: req.note,
        customer_message: req.customerMessage,
        incident_ref: req.incidentRef,
        granted_by: auth.userId,
        granted_by_email: auth.email,
      };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: insertError } = await (admin as any)
      .from('subscription_extensions')
      .insert(grants)
      .select('id, account_id, extended_until');

    if (insertError) {
      console.error(
        '[admin/subscription-extensions] insert failed:',
        insertError
      );
      return NextResponse.json(
        { error: 'Failed to record extensions' },
        { status: 500 }
      );
    }

    // Mirror each grant onto the account's own billing audit log, so an
    // owner reading subscription_events sees the credit alongside every
    // other change to their subscription.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('subscription_events').insert(
      grants.map((grant) => ({
        account_id: grant.account_id,
        event_type: 'admin_extension',
        from_plan: subs.get(grant.account_id)?.plan ?? 'starter',
        to_plan: subs.get(grant.account_id)?.plan ?? 'starter',
        metadata: {
          actor_user_id: auth.userId,
          actor_email: auth.email,
          days: grant.days,
          reason: grant.reason,
          note: grant.note,
          incident_ref: grant.incident_ref,
          period_end_before: grant.period_end_before,
          extended_until: grant.extended_until,
          via: 'admin_otp',
        },
      }))
    );

    console.log(
      `[admin/subscription-extensions] granted ${req.days}d to ${req.accountIds.length} account(s), reason=${req.reason}, incident=${req.incidentRef ?? '-'} by admin ${auth.userId} (OTP verified)`
    );

    const insertedRows = (inserted ?? []) as {
      id: string;
      account_id: string;
      extended_until: string;
    }[];

    const results = insertedRows.map((row) => ({
      accountId: row.account_id,
      newPeriodEnd: effectivePeriodEnd(
        subs.get(row.account_id)?.current_period_end ?? null,
        row.extended_until
      ),
    }));

    // The credit is already real at this point. Telling the customer is
    // best-effort on top of it: a WhatsApp or email failure is recorded
    // against the row for a human to chase, never a reason to fail the
    // request and leave the admin unsure whether the days were granted.
    let notified = 0;
    if (req.notify) {
      const outcomes = await Promise.all(
        insertedRows.map(async (row) => {
          const newPeriodEnd = effectivePeriodEnd(
            subs.get(row.account_id)?.current_period_end ?? null,
            row.extended_until
          );
          try {
            const recipients = await notifyExtensionGranted(admin, {
              extensionId: row.id,
              accountId: row.account_id,
              days: req.days,
              reason: req.reason,
              customerMessage: req.customerMessage,
              newPeriodEnd,
            });
            return { id: row.id, recipients };
          } catch (err) {
            console.error(
              '[admin/subscription-extensions] notify failed:',
              err
            );
            return {
              id: row.id,
              recipients: [
                { error: err instanceof Error ? err.message : String(err) },
              ],
            };
          }
        })
      );

      notified = outcomes.filter((o) =>
        o.recipients.some(
          (r) =>
            'whatsapp' in r &&
            (r.whatsapp?.sent || r.email?.sent || r.inApp?.sent)
        )
      ).length;

      await Promise.all(
        outcomes.map((outcome) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (admin as any)
            .from('subscription_extensions')
            .update({
              notified_at: new Date().toISOString(),
              notification_result: outcome.recipients,
            })
            .eq('id', outcome.id)
        )
      );
    }

    return NextResponse.json({
      success: true,
      granted: grants.length,
      notified,
      days: req.days,
      incidentRef: req.incidentRef,
      results,
    });
  } catch (error) {
    console.error('[admin/subscription-extensions] POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
