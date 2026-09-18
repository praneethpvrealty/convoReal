import { NextResponse } from 'next/server';

import {
  requireRole,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { writeDealEvent } from '@/lib/deals/events';
import { actorName, loadDealHead } from '@/lib/deals/server';
import {
  dealShareUrl,
  mintDealShareToken,
  parseShareLinkInput,
} from '@/lib/deals/share-links';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string }> };

function siteUrl(request: Request): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    new URL(request.url).origin
  );
}

// GET /api/deals/[id]/share-links — every link on the transaction,
// with its state. The token itself is never returned after minting.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('viewer');
    const { id: dealId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from('deal_share_links')
      .select(
        'id, stakeholder_id, token_prefix, expires_at, revoked_at, otp_required, view_count, last_viewed_at, created_at, ' +
          'stakeholder:deal_stakeholders(id, name, role, side)'
      )
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/deals/[id]/share-links — mint a link for one stakeholder.
// The plaintext token is returned exactly once, in this response.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId } = await params;

    const limit = await checkRateLimit(
      `agent:dealShareLink:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const parsed = parseShareLinkInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data: stakeholder } = await ctx.supabase
      .from('deal_stakeholders')
      .select('id, name, side, email')
      .eq('id', parsed.value.stakeholderId)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!stakeholder) {
      return NextResponse.json(
        { error: 'Stakeholder not found on this deal' },
        { status: 404 }
      );
    }
    if (stakeholder.side === 'internal') {
      return NextResponse.json(
        {
          error:
            'Internal stakeholders use the workspace itself; a link is for the buyer or seller side.',
        },
        { status: 409 }
      );
    }
    if (parsed.value.otpRequired && !stakeholder.email) {
      return NextResponse.json(
        {
          error:
            'A one-time code needs somewhere to go. Add an email address for this stakeholder first.',
        },
        { status: 409 }
      );
    }

    const minted = mintDealShareToken(parsed.value.ttlMs);
    const { data, error } = await ctx.supabase
      .from('deal_share_links')
      .insert({
        account_id: ctx.accountId,
        deal_id: dealId,
        stakeholder_id: stakeholder.id,
        token_hash: minted.hash,
        token_prefix: minted.prefix,
        expires_at: minted.expiresAt,
        otp_required: parsed.value.otpRequired,
        created_by: ctx.userId,
      })
      .select(
        'id, stakeholder_id, token_prefix, expires_at, revoked_at, otp_required, view_count, last_viewed_at, created_at'
      )
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const outcome = await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'link_created',
      title: `Share link created for ${stakeholder.name}`,
      actorId: ctx.userId,
      actorName: await actorName(ctx.supabase, ctx.accountId, ctx.userId),
      source: body?.source === 'mobile' ? 'mobile' : 'web',
      metadata: {
        link_id: data.id,
        stakeholder_id: stakeholder.id,
        expires_at: minted.expiresAt,
        otp_required: parsed.value.otpRequired,
      },
    });
    if (!outcome.ok) {
      console.warn('[share-links] event not written:', outcome.error);
    }

    return NextResponse.json(
      {
        data: {
          ...data,
          url: dealShareUrl(minted.token, siteUrl(request)),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
