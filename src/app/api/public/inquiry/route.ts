import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { createNotification } from '@/lib/notifications/create';
import {
  InquiryContactError,
  fileShowcaseInquiry,
  type ShowcaseInquiryInput,
} from '@/lib/showcase/file-inquiry';
import {
  isExistingLead,
  openReferredEnquiry,
  resolveSessionReferrer,
} from '@/lib/showcase/referred-enquiries';
import {
  MAX_SHORTLIST_PROPERTIES,
  parseInquiryPropertyIds,
} from '@/lib/showcase/shortlist';
import { resolveSellerPage } from '@/lib/showcase/seller-page';

const INQUIRY_SESSION_LIMIT = { limit: 5, windowMs: 60_000 };
const INQUIRY_ACCOUNT_LIMIT = { limit: 60, windowMs: 60_000 };
const MAX_NAME_LEN = 120;
const MAX_MESSAGE_LEN = 2000;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phone, email, accountId, referrerContactId, sessionKey } = body;
    let { propertyId, propertyTitle, propertyCode } = body;
    const isShortlist = body.propertyIds !== undefined;
    const propertyIds = isShortlist
      ? parseInquiryPropertyIds(body.propertyIds)
      : null;
    if (isShortlist && (!propertyIds || body.propertyId !== undefined)) {
      return NextResponse.json(
        {
          error: `Select between 1 and ${MAX_SHORTLIST_PROPERTIES} properties for your enquiry.`,
        },
        { status: 400 }
      );
    }
    if (
      isShortlist &&
      (typeof body.name !== 'string' ||
        !body.name.trim() ||
        typeof phone !== 'string' ||
        (email !== undefined && typeof email !== 'string') ||
        (body.message !== undefined && typeof body.message !== 'string'))
    ) {
      return NextResponse.json(
        { error: 'Enter your name and a valid mobile number.' },
        { status: 400 }
      );
    }
    const isAiAgent = body.source === 'ai_agent';
    const name =
      typeof body.name === 'string'
        ? body.name.slice(0, MAX_NAME_LEN)
        : body.name;
    const message =
      typeof body.message === 'string'
        ? body.message.slice(0, MAX_MESSAGE_LEN)
        : body.message;

    if (!accountId) {
      return NextResponse.json(
        { error: "Missing required 'accountId' field" },
        { status: 400 }
      );
    }

    if (isAiAgent && body.consentToContact !== true) {
      return NextResponse.json(
        {
          error:
            'Explicit consent is required before an AI agent can create an enquiry.',
        },
        { status: 400 }
      );
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    const sessionId =
      typeof sessionKey === 'string' && sessionKey.trim()
        ? sessionKey.trim().slice(0, 64)
        : ip;
    const sessionLimit = await checkRateLimit(
      `inquiry:session:${sessionId}`,
      INQUIRY_SESSION_LIMIT
    );
    if (!sessionLimit.success) return rateLimitResponse(sessionLimit);
    const accountLimit = await checkRateLimit(
      `inquiry:account:${accountId}`,
      INQUIRY_ACCOUNT_LIMIT
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    if (!phone) {
      return NextResponse.json(
        { error: "Missing required 'phone' field" },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhoneWithCountryCode(phone);
    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    // 1. Fetch account owner_user_id to use as user_id for contact notes & default tasks
    const { data: account, error: accountError } = await admin
      .from('accounts')
      .select('owner_user_id, status')
      .eq('id', accountId)
      .maybeSingle();

    if (accountError || !account) {
      console.error(
        '[POST /api/public/inquiry] Account lookup failed:',
        accountError
      );
      return NextResponse.json(
        { error: 'Invalid account ID' },
        { status: 400 }
      );
    }

    const systemUserId = account.owner_user_id;
    const sellerPage = body.sellerPage
      ? await resolveSellerPage(admin, body.sellerPage, accountId)
      : null;
    let shortlistProperties: Array<{
      id: string;
      title: string;
      property_code: string | null;
      user_id: string;
    }> = [];
    if (propertyIds) {
      if (account.status === 'archived')
        return NextResponse.json(
          { error: 'This showcase is unavailable.' },
          { status: 400 }
        );
      const { data: listed, error: listedError } = await admin
        .from('properties')
        .select('id, title, property_code, user_id')
        .eq('account_id', accountId)
        .eq('is_published', true)
        .eq('status', 'Available')
        .in('id', propertyIds);
      if (listedError) throw listedError;
      if (!listed || listed.length !== propertyIds.length) {
        return NextResponse.json(
          {
            error:
              'Some selected properties are no longer available. Refresh the showcase and review your shortlist before trying again.',
          },
          { status: 409 }
        );
      }
      shortlistProperties = propertyIds.map((id) =>
        listed.find((property) => property.id === id)!
      );
      propertyId = shortlistProperties[0].id;
      propertyTitle = `${shortlistProperties.length} shortlisted ${shortlistProperties.length === 1 ? 'property' : 'properties'}`;
      propertyCode = undefined;
      if (referrerContactId) {
        const { data: referrer, error: referrerError } = await admin
          .from('contacts')
          .select('id')
          .eq('account_id', accountId)
          .eq('id', referrerContactId)
          .maybeSingle();
        if (referrerError) throw referrerError;
        if (!referrer)
          return NextResponse.json(
            { error: 'Invalid enquiry referral.' },
            { status: 400 }
          );
      }
    }
    // Resolve the managing agent of the property if propertyId is provided
    let targetAgentUserId = systemUserId;
    if (
      shortlistProperties.length &&
      shortlistProperties.every(
        (property) => property.user_id === shortlistProperties[0].user_id
      )
    ) {
      targetAgentUserId = shortlistProperties[0].user_id || systemUserId;
    }
    let resolvedReferrerContactId =
      sellerPage?.contactId || referrerContactId || null;

    if (propertyId && !isShortlist) {
      const { data: propData } = await admin
        .from('properties')
        .select('user_id')
        .eq('id', propertyId)
        .eq('account_id', accountId)
        .maybeSingle();

      if (propData?.user_id) {
        targetAgentUserId = propData.user_id;

        // Try resolving the agent's contact ID using their profile email
        const { data: agentProfile } = await admin
          .from('profiles')
          .select('email')
          .eq('user_id', targetAgentUserId)
          .maybeSingle();

        if (agentProfile?.email) {
          const { data: agentContact } = await admin
            .from('contacts')
            .select('id')
            .eq('account_id', accountId)
            .eq('email', agentProfile.email)
            .maybeSingle();

          if (agentContact) {
            resolvedReferrerContactId =
              resolvedReferrerContactId || agentContact.id;
          }
        }
      }
    }

    const inquiry: ShowcaseInquiryInput = {
      accountId,
      phone: String(phone),
      normalizedPhone,
      name: typeof name === 'string' ? name : null,
      email: typeof email === 'string' ? email : null,
      message: typeof message === 'string' ? message : null,
      isAiAgent,
      isShortlist,
      propertyId: propertyId || null,
      propertyTitle: propertyTitle || null,
      propertyCode: propertyCode || null,
      shortlistProperties: shortlistProperties.map((property) => ({
        id: property.id,
        title: property.title,
        property_code: property.property_code,
      })),
      targetAgentUserId,
      referrerContactId: resolvedReferrerContactId,
      sessionKey:
        typeof sessionKey === 'string' && sessionKey.trim()
          ? sessionKey.trim()
          : null,
    };

    // A guest who reached the showcase through a link shared with
    // someone else. An agent's guest is held until that agent approves
    // (see referred-enquiries.ts); anyone else who forwarded the link
    // is credited as the referrer and the listing side is told.
    const referrer = sellerPage
      ? null
      : await resolveSessionReferrer(admin, {
          accountId,
          sessionKey: inquiry.sessionKey,
          requesterPhone: normalizedPhone,
        });
    const knownLead = referrer
      ? await isExistingLead(admin, accountId, normalizedPhone)
      : false;
    if (referrer && !knownLead) {
      inquiry.referrerContactId = referrer.contactId;
      if (referrer.isAgent) {
        const outcome = await openReferredEnquiry(admin, {
          accountId,
          referrer,
          source: 'website',
          propertyId: inquiry.propertyId,
          requesterName: inquiry.name?.trim() || 'Website visitor',
          requesterPhone: normalizedPhone,
          sessionKey: inquiry.sessionKey,
          payload: inquiry,
        });
        if (outcome !== 'undeliverable') {
          return NextResponse.json({ success: true, pendingReferral: true });
        }
      }
    }

    let contactId: string;
    try {
      ({ contactId } = await fileShowcaseInquiry(admin, inquiry));
    } catch (err) {
      if (!(err instanceof InquiryContactError)) throw err;
      console.error(
        '[POST /api/public/inquiry] Contact find-or-create failed:',
        err
      );
      return NextResponse.json(
        { error: 'Failed to process inquiry' },
        { status: 500 }
      );
    }

    if (referrer && !knownLead) {
      await createNotification({
        accountId,
        userId: targetAgentUserId,
        type: 'listing_interest',
        eventKey: 'referred_enquiry',
        title: `${referrer.name}'s guest enquired`,
        body: `${inquiry.name?.trim() || normalizedPhone} (${normalizedPhone}) asked for details on ${propertyTitle || 'your listings'} through the link you shared with ${referrer.name}.`,
        entityType: 'contact',
        entityId: contactId,
        link: `/contacts?contactId=${contactId}`,
      });
    }

    return NextResponse.json({ success: true, contactId });
  } catch (err) {
    console.error('[POST /api/public/inquiry] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
