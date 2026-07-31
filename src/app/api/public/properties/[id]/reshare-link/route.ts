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

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    const ipLimit = checkRateLimit(`reshare:ip:${ip}`, RESHARE_IP_LIMIT);
    if (!ipLimit.success) return rateLimitResponse(ipLimit);
    const accountLimit = checkRateLimit(
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
    // resolve within this account and must not be themselves.
    let parentContactId: string | null = null;
    if (typeof via_contact_id === 'string' && UUID_RE.test(via_contact_id)) {
      const { data: parent } = await admin
        .from('contacts')
        .select('id, phone')
        .eq('id', via_contact_id)
        .eq('account_id', account_id)
        .maybeSingle();
      if (
        parent &&
        normalizePhoneWithCountryCode(parent.phone || '') !== normalizedPhone
      ) {
        parentContactId = parent.id;
      }
    }

    // Find or create their contact. An existing contact keeps its
    // classification — the reshare row itself marks them a chain
    // intermediary.
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

    void (async () => {
      try {
        await sendWhatsAppMessageAndPersist({
          accountId: account_id,
          contactId,
          kind: 'text',
          senderType: 'bot',
          text: buildReshareLinkMessage({
            name: name.trim(),
            propertyTitle: property.title || 'the property',
            link,
          }),
        });
      } catch (err) {
        console.error('[reshare-link] WA send failed:', err);
      }
    })();

    return NextResponse.json({ success: true, link });
  } catch (err) {
    console.error('[POST reshare-link] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
