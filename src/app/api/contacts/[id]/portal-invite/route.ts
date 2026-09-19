import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  buildPortalInvite,
  logPersonalPortalInvite,
  sendPortalInvite,
} from '@/lib/contacts/portal-invite';
import type { Contact } from '@/types';

// GET  /api/contacts/[id]/portal-invite → the drafted invite, its link and
//      the contact's phone, so either surface can preview it or hand it to
//      personal WhatsApp.
// POST /api/contacts/[id]/portal-invite { channel: 'business' | 'personal' }
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

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: contactId } = await params;
    const ctx = await requireRole('agent');
    const contact = await loadContact(ctx.supabase, ctx.accountId, contactId);
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    const invite = await buildPortalInvite({
      db: ctx.supabase,
      accountId: ctx.accountId,
      userId: ctx.userId,
      contact,
    });
    return NextResponse.json({
      data: { ...invite, phone: contact.phone ?? null },
    });
  } catch (err) {
    console.error(
      '[GET /api/contacts/[id]/portal-invite] Unexpected error:',
      err
    );
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: contactId } = await params;
    const ctx = await requireRole('agent');
    const limit = await checkRateLimit(
      `contact:portal-invite:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as {
      channel?: string;
    };
    const channel = body.channel === 'personal' ? 'personal' : 'business';

    const contact = await loadContact(ctx.supabase, ctx.accountId, contactId);
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    if (channel === 'personal') {
      await logPersonalPortalInvite({
        db: ctx.supabase,
        accountId: ctx.accountId,
        userId: ctx.userId,
        contactId: contact.id,
      });
      return NextResponse.json({ data: { delivery: 'personal' } });
    }

    const result = await sendPortalInvite({
      db: ctx.supabase,
      accountId: ctx.accountId,
      userId: ctx.userId,
      contact,
    });
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Could not send the portal link' },
        { status: 409 }
      );
    }
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error(
      '[POST /api/contacts/[id]/portal-invite] Unexpected error:',
      err
    );
    return toErrorResponse(err);
  }
}
