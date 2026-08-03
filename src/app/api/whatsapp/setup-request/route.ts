import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { findOrCreateContact } from '@/lib/contacts/find-or-create';
import { assignTagsToContact } from '@/app/api/leads/email-webhook/db-utils';

// POST /api/whatsapp/setup-request
// "Do it for me" handoff from the guided WhatsApp setup. A signed-in
// consultant who doesn't want to drive Meta's console themselves leaves
// their details; like /api/public/engine-lead, the request lands as a
// tagged contact + note in ConvoReal's master account so the concierge
// queue runs on the same pipeline as sales — no separate table.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  try {
    const limited = checkRateLimit(`wa-setup-request:${ctx.accountId}`, {
      limit: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (!limited.success) return rateLimitResponse(limited);

    const body = (await request.json().catch(() => null)) as {
      name?: string;
      business_name?: string;
      phone?: string;
      number_in_use?: boolean;
      city?: string;
      notes?: string;
    } | null;

    const name = (body?.name || '').trim().slice(0, 120);
    const businessName = (body?.business_name || '').trim().slice(0, 120);
    const rawPhone = (body?.phone || '').trim();
    const numberInUse = body?.number_in_use === true;
    const city = (body?.city || '').trim().slice(0, 80);
    const notes = (body?.notes || '').trim().slice(0, 1000);

    if (!rawPhone) {
      return NextResponse.json(
        { error: 'Please share the WhatsApp number you want to connect.' },
        { status: 400 }
      );
    }
    const phone = normalizePhoneWithCountryCode(rawPhone);
    if (!phone) {
      return NextResponse.json(
        {
          error:
            'That number looks off — please re-enter it with your area code.',
        },
        { status: 400 }
      );
    }

    const masterAccountId = process.env.CONVOREAL_MASTER_ACCOUNT_ID;
    if (!masterAccountId || !UUID_RE.test(masterAccountId)) {
      console.warn(
        '[POST /api/whatsapp/setup-request] CONVOREAL_MASTER_ACCOUNT_ID not configured — skipping capture.'
      );
      return NextResponse.json({
        success: true,
        captured: false,
        whatsappLink: null,
      });
    }

    const db = supabaseAdmin();

    const { data: account } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', masterAccountId)
      .maybeSingle();
    if (!account?.owner_user_id) {
      console.error(
        '[POST /api/whatsapp/setup-request] master account not found or has no owner.'
      );
      return NextResponse.json({
        success: true,
        captured: false,
        whatsappLink: null,
      });
    }
    const userId = account.owner_user_id as string;

    let contactId: string;
    try {
      const result = await findOrCreateContact(db, {
        accountId: masterAccountId,
        userId,
        phone,
        name: name || businessName || 'WhatsApp Setup Request',
        classification: 'Agent',
        referrer: 'WhatsApp Concierge Setup',
        company: businessName || null,
      });
      contactId = result.contactId;
    } catch (err) {
      console.error(
        '[POST /api/whatsapp/setup-request] contact create failed:',
        err
      );
      return NextResponse.json({
        success: true,
        captured: false,
        whatsappLink: null,
      });
    }

    const tags = ['ConvoReal Prospect', 'WhatsApp Concierge'];
    if (city) tags.push(city);
    try {
      await assignTagsToContact(db, masterAccountId, userId, contactId, tags);
    } catch (err) {
      console.error(
        '[POST /api/whatsapp/setup-request] tagging failed (non-fatal):',
        err
      );
    }

    const noteLines = [
      'WhatsApp concierge setup request (from the guided setup):',
      `• Workspace: ${ctx.account.name} (${ctx.accountId})`,
      businessName ? `• Business name: ${businessName}` : null,
      `• Number to connect: ${phone}`,
      `• Number currently on the WhatsApp app: ${numberInUse ? 'yes — will need migration' : 'no'}`,
      city ? `• City: ${city}` : null,
      notes ? `• Notes: ${notes}` : null,
    ].filter(Boolean);
    try {
      await db.from('contact_notes').insert({
        account_id: masterAccountId,
        contact_id: contactId,
        user_id: userId,
        note_text: noteLines.join('\n'),
      });
    } catch (err) {
      console.error(
        '[POST /api/whatsapp/setup-request] note insert failed (non-fatal):',
        err
      );
    }

    const { data: settings } = await db
      .from('showcase_settings')
      .select('contact_phone')
      .eq('account_id', masterAccountId)
      .maybeSingle();
    const salesPhone = (settings?.contact_phone || '').replace(/\D/g, '');
    const whatsappLink = salesPhone
      ? `https://wa.me/${salesPhone}?text=${encodeURIComponent(
          `Hi! I've requested help setting up my WhatsApp Business number on ConvoReal${businessName ? ` for ${businessName}` : ''}.`
        )}`
      : null;

    return NextResponse.json({ success: true, captured: true, whatsappLink });
  } catch (err) {
    console.error('[POST /api/whatsapp/setup-request] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
