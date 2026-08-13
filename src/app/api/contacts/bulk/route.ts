import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * Bulk contact cleanup — the tool that lets an account stop carrying
 * leads who are gone so the list is worth reading again.
 *
 * GET  returns the candidate counts per condition, so the dialog can
 *      say "this will affect 307 contacts" before anything happens.
 * POST applies one action to either an explicit id list (the rows the
 *      agent ticked) or a whole condition.
 *
 * Conditions are resolved by `contact_cleanup_candidates` (migration
 * 228) rather than rebuilt here: the count the agent was shown and the
 * set that gets acted on then come from the same SQL, and neither ships
 * the contact list to the browser to be filtered.
 */

const CONDITIONS = ['dead_or_opted_out', 'stale', 'never_responded'] as const;
type Condition = (typeof CONDITIONS)[number];

const ACTIONS = [
  'archive',
  'unarchive',
  'mark_dead',
  'revive',
  'delete',
] as const;
type Action = (typeof ACTIONS)[number];

/** Ceiling on one call. Keeps a mis-click from rewriting an entire book. */
const MAX_BATCH = 2000;

const DEFAULT_STALE_DAYS = 90;

function parseStaleDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_STALE_DAYS;
  return Math.min(3650, Math.max(1, Math.trunc(n)));
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const staleDays = parseStaleDays(
      request.nextUrl.searchParams.get('staleDays') ?? DEFAULT_STALE_DAYS
    );

    const { data, error } = await ctx.supabase.rpc('contact_cleanup_counts', {
      p_account_id: ctx.accountId,
      p_stale_days: staleDays,
    });

    if (error) {
      console.error('[GET /api/contacts/bulk] counts failed:', error);
      return NextResponse.json(
        { error: error.message ?? 'Failed to load cleanup counts' },
        { status: 500 }
      );
    }

    const row = (Array.isArray(data) ? data[0] : data) ?? {};
    return NextResponse.json({
      data: {
        staleDays,
        dead_or_opted_out: Number(row.dead_or_opted_out ?? 0),
        stale: Number(row.stale ?? 0),
        never_responded: Number(row.never_responded ?? 0),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `contacts:bulk:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const action = body.action as Action;
    if (!ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action must be one of ${ACTIONS.join(', ')}` },
        { status: 400 }
      );
    }

    // Deleting in bulk is the one irreversible action here, so it takes
    // an explicit confirmation rather than riding on a single click.
    if (action === 'delete' && body.confirm !== 'DELETE') {
      return NextResponse.json(
        {
          error: 'Bulk delete requires confirm: "DELETE"',
          code: 'CONFIRM_REQUIRED',
        },
        { status: 400 }
      );
    }

    let ids: string[] = [];

    if (Array.isArray(body.ids)) {
      ids = body.ids.filter(
        (id: unknown): id is string => typeof id === 'string'
      );
    } else if (typeof body.condition === 'string') {
      if (!CONDITIONS.includes(body.condition as Condition)) {
        return NextResponse.json(
          { error: `condition must be one of ${CONDITIONS.join(', ')}` },
          { status: 400 }
        );
      }
      const { data, error } = await ctx.supabase.rpc(
        'contact_cleanup_candidates',
        {
          p_account_id: ctx.accountId,
          p_condition: body.condition,
          p_stale_days: parseStaleDays(body.staleDays ?? DEFAULT_STALE_DAYS),
        }
      );
      if (error) {
        console.error('[POST /api/contacts/bulk] candidates failed:', error);
        return NextResponse.json(
          { error: error.message ?? 'Failed to resolve contacts' },
          { status: 500 }
        );
      }
      ids = ((data ?? []) as { contact_id: string }[]).map((r) => r.contact_id);
    } else {
      return NextResponse.json(
        { error: 'Provide either ids[] or condition' },
        { status: 400 }
      );
    }

    if (ids.length === 0) {
      return NextResponse.json({ data: { affected: 0, skipped: 0 } });
    }
    if (ids.length > MAX_BATCH) {
      return NextResponse.json(
        {
          error: `That matches ${ids.length} contacts — more than the ${MAX_BATCH} one request may change. Narrow the condition and run it again.`,
          code: 'BATCH_TOO_LARGE',
          matched: ids.length,
        },
        { status: 400 }
      );
    }

    // Deletion follows the same ownership rule as DELETE
    // /api/contacts/[id]: a manager may remove anyone's contact, an
    // agent only the ones they saved. Filtered here so a mixed
    // selection deletes what it may and reports the rest instead of
    // failing whole.
    let skipped = 0;
    if (action === 'delete' && ctx.orgRole !== 'org_manager') {
      const { data: owned, error: ownErr } = await ctx.supabase
        .from('contacts')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('user_id', ctx.userId)
        .in('id', ids);
      if (ownErr) {
        console.error(
          '[POST /api/contacts/bulk] ownership check failed:',
          ownErr
        );
        return NextResponse.json(
          { error: ownErr.message ?? 'Failed to check contact ownership' },
          { status: 500 }
        );
      }
      const ownedIds = new Set((owned ?? []).map((r) => r.id as string));
      skipped = ids.length - ownedIds.size;
      ids = ids.filter((id) => ownedIds.has(id));
      if (ids.length === 0) {
        return NextResponse.json({ data: { affected: 0, skipped } });
      }
    }

    const now = new Date().toISOString();
    const patches: Record<
      Exclude<Action, 'delete'>,
      Record<string, unknown>
    > = {
      archive: { is_archived: true, archived_at: now, updated_at: now },
      unarchive: { is_archived: false, archived_at: null, updated_at: now },
      mark_dead: {
        is_dead: true,
        dead_at: now,
        dead_reason: 'bulk_cleanup',
        requirement_active: false,
        buyer_alerts_consent: 'declined',
        updated_at: now,
      },
      // Alerts stay declined: the lead opted out in their own words, and
      // restoring a record is not consent to message them again.
      revive: {
        is_dead: false,
        dead_at: null,
        dead_reason: null,
        requirement_active: true,
        updated_at: now,
      },
    };

    const { data, error } =
      action === 'delete'
        ? await ctx.supabase
            .from('contacts')
            .delete()
            .eq('account_id', ctx.accountId)
            .in('id', ids)
            .select('id')
        : await ctx.supabase
            .from('contacts')
            .update(patches[action])
            .eq('account_id', ctx.accountId)
            .in('id', ids)
            .select('id');

    if (error) {
      console.error(`[POST /api/contacts/bulk] ${action} failed:`, error);
      return NextResponse.json(
        { error: error.message ?? `Failed to ${action} contacts` },
        { status: 500 }
      );
    }

    // RLS can silently drop rows the caller may read but not write, so
    // report what actually changed rather than what was requested.
    const affected = (data ?? []).length;
    return NextResponse.json({
      data: { affected, skipped: skipped + (ids.length - affected) },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
