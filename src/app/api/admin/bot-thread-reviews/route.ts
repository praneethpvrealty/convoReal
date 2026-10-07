// ============================================================
// /api/admin/bot-thread-reviews — the nightly bot thread review queue.
//
//   GET   — reviewed threads, newest first; ?verdict=fail|pass|unscored|all
//           (default: fail and unscored, the ones worth a look), a page
//           at a time: ?limit (50, at most 100) and ?before=<cursor> from
//           the previous page's nextCursor (reviewed_at and id, so a
//           page boundary inside one timestamp loses nothing).
//   PATCH — the platform's own verdict on a thread: good, bad, or
//           cleared, with a note. A thread marked bad is what "Copy as
//           fixture" turns into a pinned transcript.
//
// Super-admin only, service-role client — same posture as
// /api/admin/bug-reports: the super_admin check IS the boundary.
// ============================================================

import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';

const VERDICTS = ['fail', 'pass', 'unscored'] as const;
const ADMIN_VERDICTS = ['good', 'bad'] as const;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCursor(
  raw: string | null
): { reviewedAt: string; id: string } | null {
  const at = raw?.lastIndexOf('|') ?? -1;
  if (!raw || at < 0) return null;
  const reviewedAt = raw.slice(0, at);
  const id = raw.slice(at + 1);
  if (!Number.isFinite(Date.parse(reviewedAt)) || !UUID.test(id)) return null;
  return { reviewedAt, id };
}

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const params = new URL(request.url).searchParams;
  const verdict = params.get('verdict') ?? '';
  const cursor = parseCursor(params.get('before'));
  const limit = Math.min(
    Math.max(Number(params.get('limit')) || DEFAULT_PAGE, 1),
    MAX_PAGE
  );
  let query = supabaseAdmin()
    .from('bot_thread_reviews')
    .select(
      'id, account_id, conversation_id, contact_id, review_day, window_start, window_end, transcript, rule_violations, score, verdict, issues, summary, model, admin_verdict, admin_note, admin_reviewed_at, reviewed_at, accounts(name), contacts(name, created_at)'
    )
    // A claim the judge has not answered yet is not a review.
    .not('judged_at', 'is', null)
    .order('reviewed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if ((VERDICTS as readonly string[]).includes(verdict)) {
    query = query.eq('verdict', verdict);
  } else if (verdict !== 'all') {
    query = query.in('verdict', ['fail', 'unscored']);
  }
  if (cursor) {
    query = query.or(
      `reviewed_at.lt."${cursor.reviewedAt}",and(reviewed_at.eq."${cursor.reviewedAt}",id.lt."${cursor.id}")`
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error('[GET /api/admin/bot-thread-reviews] fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to load bot thread reviews' },
      { status: 500 }
    );
  }
  const reviews = (data ?? []) as { id: string; reviewed_at: string }[];
  const last = reviews[reviews.length - 1];
  return NextResponse.json({
    reviews,
    nextCursor:
      reviews.length === limit ? `${last.reviewed_at}|${last.id}` : null,
  });
}

export async function PATCH(request: Request) {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  let body: { id?: unknown; adminVerdict?: unknown; adminNote?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  const adminVerdict =
    body.adminVerdict === null
      ? null
      : (ADMIN_VERDICTS as readonly unknown[]).includes(body.adminVerdict)
        ? (body.adminVerdict as (typeof ADMIN_VERDICTS)[number])
        : undefined;
  if (adminVerdict === undefined) {
    return NextResponse.json(
      { error: 'adminVerdict must be good, bad or null' },
      { status: 400 }
    );
  }
  const adminNote =
    typeof body.adminNote === 'string' ? body.adminNote.slice(0, 1000) : null;

  const { data, error } = await supabaseAdmin()
    .from('bot_thread_reviews')
    .update({
      admin_verdict: adminVerdict,
      admin_note: adminNote,
      admin_reviewed_at: adminVerdict ? new Date().toISOString() : null,
    })
    .eq('id', body.id)
    .select('id, admin_verdict, admin_note, admin_reviewed_at')
    .maybeSingle();
  if (error) {
    console.error('[PATCH /api/admin/bot-thread-reviews] update error:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ review: data });
}
