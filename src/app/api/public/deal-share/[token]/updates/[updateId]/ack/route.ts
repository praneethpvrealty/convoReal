import { NextResponse } from 'next/server';

import { writeDealEvent } from '@/lib/deals/events';
import { verifyUnlock } from '@/lib/deals/share-links';
import {
  clientIp,
  resolveShareLink,
  unlockFromRequest,
} from '@/lib/deals/share-server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

// POST /api/public/deal-share/[token]/updates/[updateId]/ack
//
// The stakeholder acknowledges one update from their portal. Scoped by
// the link the token hashes to: only the recipient row addressed
// through this link can be acknowledged, and only once.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string; updateId: string }> }
) {
  try {
    const { token, updateId } = await params;
    const limit = await checkRateLimit(
      `dealShare:${clientIp(request)}`,
      RATE_LIMITS.publicDealShare
    );
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const resolved = await resolveShareLink(admin, token);
    if (resolved.state !== 'live') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const { link, stakeholder } = resolved;
    if (
      link.otp_required &&
      !verifyUnlock(unlockFromRequest(request), link.id)
    ) {
      return NextResponse.json(
        { error: 'Locked', code: 'LOCKED' },
        { status: 401 }
      );
    }

    const { data: recipient } = await admin
      .from('deal_update_recipients')
      .select('id, acknowledged_at, update:deal_updates(headline)')
      .eq('link_id', link.id)
      .eq('account_id', link.account_id)
      .eq('update_id', updateId)
      .maybeSingle();
    if (!recipient) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (recipient.acknowledged_at) {
      return NextResponse.json({
        data: { acknowledged_at: recipient.acknowledged_at },
      });
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await admin
      .from('deal_update_recipients')
      .update({ acknowledged_at: now, acknowledged_via: 'portal' })
      .eq('id', recipient.id)
      .eq('account_id', link.account_id)
      .is('acknowledged_at', null)
      .select('id');
    if (error || !updated || updated.length === 0) {
      return NextResponse.json({ error: 'Could not record' }, { status: 500 });
    }

    const headlineRow = recipient.update as
      { headline: string } | { headline: string }[] | null;
    const headline = Array.isArray(headlineRow)
      ? headlineRow[0]?.headline
      : headlineRow?.headline;
    const outcome = await writeDealEvent({
      db: admin,
      accountId: link.account_id,
      dealId: link.deal_id,
      eventType: 'update_acknowledged',
      title: `${stakeholder.name} acknowledged "${headline ?? 'the update'}"`,
      actorId: null,
      actorName: stakeholder.name,
      source: 'system',
      metadata: {
        update_id: updateId,
        recipient_id: recipient.id,
        via: 'portal',
      },
    });
    if (!outcome.ok)
      console.warn('[deal-share] ack event not written:', outcome.error);

    return NextResponse.json({ data: { acknowledged_at: now } });
  } catch (err) {
    console.error('[deal-share] ack failed:', err);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
