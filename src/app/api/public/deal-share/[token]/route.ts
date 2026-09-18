import { NextResponse } from 'next/server';

import { buildExternalPortalView } from '@/lib/deals/external-view';
import { verifyUnlock } from '@/lib/deals/share-links';
import {
  clientIp,
  loadLinkRecipients,
  loadShareSources,
  logShareAccess,
  markUpdateOpened,
  resolveShareLink,
  trackShareView,
  unlockFromRequest,
} from '@/lib/deals/share-server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

// GET /api/public/deal-share/[token]
//
// A stakeholder's view of their transaction. Service-role, scoped by
// the link the token hashes to; the payload is built only by the
// external view, which runs everything through the visibility
// resolver. A link that demands a one-time code answers `locked` until
// a valid unlock for this link is presented.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const limit = await checkRateLimit(
      `dealShare:${clientIp(request)}`,
      RATE_LIMITS.publicDealShare
    );
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const resolved = await resolveShareLink(admin, token);
    if (resolved.state === 'missing') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (resolved.state === 'dead') {
      await logShareAccess(admin, resolved.link, 'denied', request);
      return NextResponse.json(
        {
          error: 'This link has expired or been withdrawn.',
          code: 'LINK_DEAD',
        },
        { status: 410 }
      );
    }

    const { link, stakeholder } = resolved;
    if (
      link.otp_required &&
      !verifyUnlock(unlockFromRequest(request), link.id)
    ) {
      return NextResponse.json({
        data: {
          locked: true,
          stakeholder_name: stakeholder.name,
          channel: stakeholder.email ? 'email' : null,
        },
      });
    }

    const sources = await loadShareSources(admin, link);
    if (!sources) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const view = buildExternalPortalView({
      stakeholder,
      deal: sources.deal,
      siblings: sources.siblings,
    });
    if (!view) {
      await logShareAccess(admin, link, 'denied', request);
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const openedUpdate = new URL(request.url).searchParams.get('u');
    await Promise.all([
      trackShareView(admin, link),
      logShareAccess(admin, link, 'view', request),
      openedUpdate ? markUpdateOpened(admin, link, openedUpdate) : null,
    ]);
    const acknowledgements = (await loadLinkRecipients(admin, link)).map(
      (r) => ({
        update_id: r.update_id,
        opened_at: r.opened_at,
        acknowledged_at: r.acknowledged_at,
      })
    );

    return NextResponse.json({
      data: {
        locked: false,
        expires_at: link.expires_at,
        acknowledgements,
        ...view,
      },
    });
  } catch (err) {
    console.error('[deal-share] view failed:', err);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
