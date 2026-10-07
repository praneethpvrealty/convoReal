// ============================================================
// /api/admin/bot-thread-reviews — the nightly bot thread review queue.
//
//   GET   — reviewed threads, newest first; ?verdict=fail|pass|unscored|all
//           (default: fail and unscored, the ones worth a look), a page
//           at a time: ?limit (50, at most 100) and ?before=<reviewed_at>
//           from the previous page's nextCursor.
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

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const params = new URL(request.url).searchParams;
  const verdict = params.get('verdict') ?? '';
  const before = params.get('before');
  const limit = Math.min(
    Math.max(Number(params.get('limit')) || DEFAULT_PAGE, 1),
    MAX_PAGE
  );
  let query = supabaseAdmin()
    .from('bot_thread_reviews')
    .select(
      'id, account_id, conversation_id, contact_id, review_day, window_start, window_end, transcript, rule_violations, score, verdict, issues, summary, model, admin_verdict, admin_note, admin_reviewed_at, reviewed_at, accounts(name), contacts(name, created_at)'
    )
    .order('reviewed_at', { ascending: false })
    .limit(limit);
  if ((VERDICTS as readonly string[]).includes(verdict)) {
    query = query.eq('verdict', verdict);
  } else if (verdict !== 'all') {
    query = query.in('verdict', ['fail', 'unscored']);
  }
  if (before && Number.isFinite(Date.parse(before))) {
    query = query.lt('reviewed_at', before);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[GET /api/admin/bot-thread-reviews] fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to load bot thread reviews' },
      { status: 500 }
    );
  }
  const reviews = (data ?? []) as { reviewed_at: string }[];
  return NextResponse.json({
    reviews,
    nextCursor:
      reviews.length === limit ? reviews[reviews.length - 1].reviewed_at : null,
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
