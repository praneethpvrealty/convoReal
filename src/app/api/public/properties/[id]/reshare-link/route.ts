import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import {
  buildReshareLinkMessage,
  buildReshareUrl,
  recordReshareLink,
} from '@/lib/inventory/location-requests';

const RESHARE_IP_LIMIT = { limit: 5, windowMs: 60_000 };
const RESHARE_ACCOUNT_LIMIT = { limit: 40, windowMs: 60_000 };
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/public/properties/[id]/reshare-link
// Mints a personal, attributed share link for an agent who received a
// forwarded showcase link and wants to share it onward. Records the
// who-shared-to-whom edge (parent = the attribution on the link they
// hold; first parent wins) so location requests walk the full chain of
// intermediaries. The link is also WhatsApped to them, so onward
// forwarding happens from their own chat.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: propertyId } = await params;
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const { name, phone, account_id, via_contact_id } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!phone?.trim()) {
      return NextResponse.json({ error: 'Phone is required' }, { status: 400 });
    }
    if (!account_id || !UUID_RE.test(account_id)) {
      return NextResponse.json(
        { error: 'account_id is required' },
        { status: 400 }
      );
    }
    // The caller must be holding an attributed link. Without this the
    // endpoint is an open door: an account_id and any published
    // property id were enough to write a contact into someone else's
    // account. A re-share only means anything as a link in the chain
    // anyway, so a request with no parent has nothing to attribute.
    if (typeof via_contact_id !== 'string' || !UUID_RE.test(via_contact_id)) {
      return NextResponse.json(
        { error: 'This link cannot be re-shared' },
        { status: 403 }
      );
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    const ipLimit = await checkRateLimit(`reshare:ip:${ip}`, RESHARE_IP_LIMIT);
    if (!ipLimit.success) return rateLimitResponse(ipLimit);
    const accountLimit = await checkRateLimit(
      `reshare:account:${account_id}`,
      RESHARE_ACCOUNT_LIMIT
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const normalizedPhone = normalizePhoneWithCountryCode(phone.trim());
    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    const { data: property } = await admin
      .from('properties')
      .select('id, title, property_code, user_id, is_published')
      .eq('id', propertyId)
      .eq('account_id', account_id)
      .maybeSingle();

    if (!property || !property.is_published) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }

    // The parent is the attribution on the link they hold — it must
    // resolve within this account.
    const { data: parent } = await admin
      .from('contacts')
      .select('id, phone')
      .eq('id', via_contact_id)
      .eq('account_id', account_id)
      .maybeSingle();
    if (!parent) {
      return NextResponse.json(
        { error: 'This link cannot be re-shared' },
        { status: 403 }
      );
    }

    // Re-sharing to yourself: you already hold this link, so hand it
    // back rather than recording a hop to nowhere.
    if (normalizePhoneWithCountryCode(parent.phone || '') === normalizedPhone) {
      return NextResponse.json({
        success: true,
        link: buildReshareUrl({
          propertyIdOrCode: property.property_code || property.id,
          contactId: parent.id,
        }),
        delivered: false,
      });
    }
    const parentContactId = parent.id;

    // Find or create their contact. An existing contact is left alone
    // entirely: they were already a lead of this account by some other
    // route, and re-sharing does not retract that. Only a contact this
    // endpoint brings into existence is chain_only — attribution for
    // the consent walk, not a lead the listing side may work.
    const { data: account } = await admin
      .from('accounts')
      .select('owner_user_id')
      .eq('id', account_id)
      .maybeSingle();
    const targetUserId = property.user_id || account?.owner_user_id || null;

    let contactId: string | null = null;
    const { data: existingContacts } = await admin
      .from('contacts')
      .select('id')
      .eq('account_id', account_id)
      .eq('phone', normalizedPhone);
    if (existingContacts && existingContacts.length > 0) {
      contactId = existingContacts[0].id;
    } else {
      const { data: newContact } = await admin
        .from('contacts')
        .insert({
          account_id,
          user_id: targetUserId,
          phone: normalizedPhone,
          name: name.trim(),
          classification: 'Agent',
          status: 'pending_review',
          referrer: 'Co-broker Reshare',
          chain_only: true,
        })
        .select('id')
        .single();
      contactId = newContact?.id || null;
    }
    if (!contactId) {
      return NextResponse.json(
        { error: 'Failed to create your share link' },
        { status: 500 }
      );
    }

    await recordReshareLink(admin, {
      accountId: account_id,
      propertyId,
      contactId,
      parentContactId,
    });

    const link = buildReshareUrl({
      propertyIdOrCode: property.property_code || property.id,
      contactId,
    });

    // The link is on screen with a copy button regardless, so WhatsApp
    // is a convenience here rather than the delivery. It goes out only
    // while their own 24-hour service window happens to be open, and
    // the outcome is reported so the page can say which happened —
    // previously this was fired and forgotten while the response
    // claimed success, and every send failed the window check unseen.
    //
    // Deliberately no template fallback, unlike the location reveal: a
    // template here would be the listing account pushing a message at
    // a party downstream of its co-broker, which is the thing
    // chain_only exists to prevent.
    let delivered = false;
    try {
      const sent = await sendWhatsAppMessageAndPersist({
        accountId: account_id,
        contactId,
        kind: 'text',
        senderType: 'bot',
        text: buildReshareLinkMessage({
          name: name.trim(),
          propertyTitle: property.title || 'the property',
          link,
        }),
        allowChainOnly: true,
      });
      delivered = sent.success;
      if (!sent.success) {
        console.error('[reshare-link] WA send failed:', sent.error);
      }
    } catch (err) {
      console.error('[reshare-link] WA send failed:', err);
    }

    return NextResponse.json({ success: true, link, delivered });
  } catch (err) {
    console.error('[POST reshare-link] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
