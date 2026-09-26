import { NextRequest, NextResponse } from 'next/server';
import {
  requireRole,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  buildPortfolioInvite,
  logPersonalPortfolioInvite,
  parsePortfolioSide,
  PORTFOLIO_INVITE_NOT_ELIGIBLE_ERROR,
  sendPortfolioInvite,
} from '@/lib/contacts/portfolio-invite';
import type { Contact } from '@/types';

// GET  /api/contacts/[id]/portfolio-invite?side=buyer|owner → which Portfolio
//      sides the contact can sign in to, and the drafted invite for one.
// POST /api/contacts/[id]/portfolio-invite
//      { channel: 'business' | 'personal', side?: 'buyer' | 'owner' }
//      business → sends from the account's WhatsApp Business number
//      personal → records that the agent shared it from their own phone

type RouteParams = { params: Promise<{ id: string }> };

async function loadContact(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  contactId: string
): Promise<Contact | null> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  return (data as Contact | null) ?? null;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: contactId } = await params;
    const ctx = await requireRole('agent');
    const contact = await loadContact(ctx.supabase, ctx.accountId, contactId);
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    const invite = await buildPortfolioInvite({
      db: ctx.supabase,
      accountId: ctx.accountId,
      userId: ctx.userId,
      contact,
      side: parsePortfolioSide(new URL(request.url).searchParams.get('side')),
    });
    return NextResponse.json({
      data: { ...invite, phone: contact.phone ?? null },
    });
  } catch (err) {
    console.error(
      '[GET /api/contacts/[id]/portfolio-invite] Unexpected error:',
      err
    );
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: contactId } = await params;
    const ctx = await requireWriteRole('agent');
    const limit = await checkRateLimit(
      `contact:portfolio-invite:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as {
      channel?: string;
      side?: string;
    };
    const channel = body.channel === 'personal' ? 'personal' : 'business';
    const side = parsePortfolioSide(body.side);

    const contact = await loadContact(ctx.supabase, ctx.accountId, contactId);
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    if (channel === 'personal') {
      const invite = await buildPortfolioInvite({
        db: ctx.supabase,
        accountId: ctx.accountId,
        userId: ctx.userId,
        contact,
        side,
      });
      if (!invite.side) {
        return NextResponse.json(
          { error: PORTFOLIO_INVITE_NOT_ELIGIBLE_ERROR },
          { status: 409 }
        );
      }
      await logPersonalPortfolioInvite({
        db: ctx.supabase,
        accountId: ctx.accountId,
        userId: ctx.userId,
        contactId: contact.id,
        side: invite.side,
      });
      return NextResponse.json({
        data: { delivery: 'personal', side: invite.side },
      });
    }

    const result = await sendPortfolioInvite({
      db: ctx.supabase,
      accountId: ctx.accountId,
      userId: ctx.userId,
      contact,
      side,
    });
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Could not send the Portfolio invite' },
        { status: 409 }
      );
    }
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error(
      '[POST /api/contacts/[id]/portfolio-invite] Unexpected error:',
      err
    );
    return toErrorResponse(err);
  }
}
