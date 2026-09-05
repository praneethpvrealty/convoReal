import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { resolveConversation } from '@/lib/conversations/resolve';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import {
  hasReshareLink,
  notifyOwnerQueue,
  requestConsentFromContact,
} from '@/lib/inventory/location-requests';
import { isTeaserGated } from '@/lib/inventory/showcase-visibility';

const LOCREQ_IP_LIMIT = { limit: 5, windowMs: 60_000 };
const LOCREQ_ACCOUNT_LIMIT = { limit: 40, windowMs: 60_000 };
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/public/properties/[id]/location-request
// Lets a showcase visitor request the exact location (and private
// photos) of a guarded listing. Directly-attributed visitors go to the
// listing side's approval queue; visitors who came through a co-broker
// share start that co-broker's consent chain instead, and their
// identity never reaches the listing side in the clear (no Engine contact
// is created for them).
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

    const {
      requester_name,
      requester_phone,
      account_id,
      via_contact_id,
      via_share_id,
      scope: requestedScope,
    } = body;

    if (!requester_name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!requester_phone?.trim()) {
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
    const ipLimit = await checkRateLimit(`locreq:ip:${ip}`, LOCREQ_IP_LIMIT);
    if (!ipLimit.success) return rateLimitResponse(ipLimit);
    const accountLimit = await checkRateLimit(
      `locreq:account:${account_id}`,
      LOCREQ_ACCOUNT_LIMIT
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const normalizedPhone = normalizePhoneWithCountryCode(
      requester_phone.trim()
    );
    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    const { data: property, error: propErr } = await admin
      .from('properties')
      .select(
        'id, title, property_code, user_id, is_published, showcase_visibility'
      )
      .eq('id', propertyId)
      .eq('account_id', account_id)
      .maybeSingle();

    if (propErr || !property || !property.is_published) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }

    // 'listing' is only meaningful for a teaser-gated listing, and a
    // caller must not be able to turn an ordinary location request into
    // a page unlock by asserting a scope the property does not have.
    const scope =
      requestedScope === 'listing' && isTeaserGated(property)
        ? 'listing'
        : 'location';

    const { count: existingCount } = await admin
      .from('property_location_requests')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .eq('requester_phone', normalizedPhone)
      .eq('status', 'pending');

    if ((existingCount ?? 0) >= 3) {
      return NextResponse.json(
        {
          error:
            'You already have a pending location request for this property. Please wait for a response.',
        },
        { status: 429 }
      );
    }

    // Attribution must resolve within the same account or it is dropped —
    // a forged id from another tenant must not route consent anywhere.
    // The consent chain applies only when the link's recipient is a
    // CO-BROKER — classification 'Agent' or a recorded re-sharer of this
    // property: buyer-attributed links (v= is used for both) and a
    // co-broker requesting for themselves are direct requests.
    let viaContactId: string | null = null;
    if (typeof via_contact_id === 'string' && UUID_RE.test(via_contact_id)) {
      const { data: viaContact } = await admin
        .from('contacts')
        .select('id, phone, classification')
        .eq('id', via_contact_id)
        .eq('account_id', account_id)
        .maybeSingle();
      if (
        viaContact &&
        normalizePhoneWithCountryCode(viaContact.phone || '') !==
          normalizedPhone &&
        (viaContact.classification === 'Agent' ||
          (await hasReshareLink(admin, account_id, propertyId, viaContact.id)))
      ) {
        viaContactId = viaContact.id;
      }
    }
    let viaShareId: string | null = null;
    if (typeof via_share_id === 'string' && UUID_RE.test(via_share_id)) {
      const { data: viaShare } = await admin
        .from('showcase_share_links')
        .select('id')
        .eq('id', via_share_id)
        .eq('account_id', account_id)
        .maybeSingle();
      viaShareId = viaShare?.id ?? null;
    }

    const { data: locRequest, error: insertErr } = await admin
      .from('property_location_requests')
      .insert({
        property_id: propertyId,
        account_id,
        requester_name: requester_name.trim(),
        requester_phone: normalizedPhone,
        status: 'pending',
        via_contact_id: viaContactId,
        via_share_id: viaShareId,
        scope,
      })
      .select(
        'id, account_id, property_id, requester_name, requester_phone, via_contact_id, contact_id, scope'
      )
      .single();

    if (insertErr || !locRequest) {
      console.error('[POST location-request] Insert error:', insertErr);
      return NextResponse.json(
        { error: 'Failed to submit request' },
        { status: 500 }
      );
    }

    if (viaContactId) {
      // Co-broker chain: ask the intermediary first. If they are
      // unreachable on WhatsApp, fall back to the owner queue (identity
      // stays masked there regardless).
      const asked = await requestConsentFromContact(
        admin,
        locRequest,
        viaContactId
      );
      if (!asked) {
        await notifyOwnerQueue(admin, locRequest);
      }
    } else {
      // Direct buyer: capture the lead and thread the request into the
      // inbox, mirroring document requests. Never done for co-broker
      // attributed requests — their client is not this account's lead.
      const { data: account } = await admin
        .from('accounts')
        .select('owner_user_id')
        .eq('id', account_id)
        .maybeSingle();
      const targetAgentUserId =
        property.user_id || account?.owner_user_id || null;

      let contactId: string | null = null;
      try {
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
              user_id: targetAgentUserId,
              phone: normalizedPhone,
              name: requester_name.trim(),
              classification: 'Buyer',
              status: 'pending_review',
              referrer: 'Location Request',
            })
            .select('id')
            .single();
          contactId = newContact?.id || null;
        }
        if (contactId) {
          await admin
            .from('property_location_requests')
            .update({ contact_id: contactId })
            .eq('id', locRequest.id);
        }
      } catch (err) {
        console.error('[location-request] Contact upsert failed:', err);
      }

      if (contactId) {
        try {
          const { conversation } = await resolveConversation<{
            id: string;
            unread_count: number | null;
          }>(admin, {
            accountId: account_id,
            contactId,
            userId: targetAgentUserId,
            onCreate: { unread_count: 0 },
            columns: 'id, unread_count',
          });

          const conversationId: string | undefined = conversation?.id;
          const currentUnread = conversation?.unread_count || 0;

          if (conversationId) {
            const inboxText =
              `${scope === 'listing' ? '🔓 *Listing Access Request*' : '📍 *Location Reveal Request*'}\n\n` +
              `🏡 *Property*: ${property.title}${property.property_code ? ` (${property.property_code})` : ''}\n` +
              `👤 *Name*: ${requester_name.trim()}\n` +
              `📞 *Phone*: ${normalizedPhone}\n\n` +
              `_Open the property in the Engine dashboard to Approve or Reject this request._`;

            // Not 'customer': a synthetic customer row would fool the
            // dispatcher's 24-hour-window check into free-form sends
            // that Meta then fails asynchronously with 131047 — the
            // request came from the web, not from a WhatsApp message.
            await admin.from('messages').insert({
              conversation_id: conversationId,
              sender_type: 'bot',
              private: true,
              content_type: 'text',
              content_text: inboxText,
              message_id: `location-request-${locRequest.id}`,
              status: 'delivered',
              created_at: new Date().toISOString(),
            });
            await admin
              .from('conversations')
              .update({
                last_message_text: inboxText,
                last_message_at: new Date().toISOString(),
                unread_count: currentUnread + 1,
                awaiting_reply: true,
                // See /api/public/inquiry: a web form does not open
                // Meta's free-form window, so it must not stamp the anchor.
                updated_at: new Date().toISOString(),
              })
              .eq('id', conversationId);
          }
        } catch (err) {
          console.error('[location-request] Inbox routing failed:', err);
        }
      }

      await notifyOwnerQueue(admin, locRequest);
    }

    return NextResponse.json({
      success: true,
      requestId: locRequest.id,
      scope,
    });
  } catch (err) {
    console.error('[POST location-request] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
