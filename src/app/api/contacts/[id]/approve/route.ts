import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  buildInquiryDetailsMessage,
  propertyShowcaseUrl,
  showcaseBaseUrl,
} from '@/lib/share-message-builder';
import { fallbackSiteUrl } from '@/lib/showcase/site-url';
import { sendPropertyToContact } from '@/lib/whatsapp/share-property-send';
import type { Property } from '@/types';

// POST /api/contacts/[id]/approve
//
// Approve a pending_review lead and send the details of the property
// they inquired about, in one call.
//
// This used to be six sequential round trips from the client — flip the
// contact, load the property, load showcase settings, find or create the
// conversation, clear the handoff flag, then POST the send. Each leg
// paid mobile latency, so the agent watched a spinner for ten seconds
// on a flow that is a few hundred milliseconds of actual work. Doing it
// here costs the client one request and lets the legs that don't depend
// on each other run in parallel.

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: contactId } = await params;
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(`contact:approve:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: contact, error: contactErr } = await ctx.supabase
      .from('contacts')
      .select('id, name, status, last_inquired_property_id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contactErr) throw contactErr;
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    const { data: approved, error: updateErr } = await ctx.supabase
      .from('contacts')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .select('id');
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
    if (!approved?.length) {
      // The read above passed, so this is the write policy refusing —
      // approving and then sending details on an unapproved contact
      // would be worse than stopping here.
      return NextResponse.json(
        { error: 'You do not have permission to approve this contact.' },
        { status: 403 },
      );
    }

    const propertyId = contact.last_inquired_property_id as string | null;
    if (!propertyId) {
      // Approved, but there is nothing to send — the lead never named a
      // property. Still a success; the client just skips the send copy.
      return NextResponse.json({ data: { approved: true, sent: false } });
    }

    // Independent of each other, so they overlap rather than queue.
    const [{ data: property, error: propertyErr }, { data: settings }] = await Promise.all([
      ctx.supabase
        .from('properties')
        .select('*')
        .eq('id', propertyId)
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      ctx.supabase
        .from('showcase_settings')
        .select('subdomain, currency')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
    ]);
    if (propertyErr) throw propertyErr;
    if (!property) {
      // The inquiry points at a listing that no longer exists — the
      // approval itself stands.
      return NextResponse.json({ data: { approved: true, sent: false } });
    }
    const typedProperty = property as Property;

    const base = showcaseBaseUrl(
      fallbackSiteUrl(),
      (settings?.subdomain as string | null) ?? null,
      ctx.accountId,
    );
    const detailsMessage = buildInquiryDetailsMessage({
      property: typedProperty,
      url: propertyShowcaseUrl(base, typedProperty),
      currency: (settings?.currency as string | undefined) ?? undefined,
    });

    const outcome = await sendPropertyToContact({
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId,
      contactName: (contact.name as string | null) ?? null,
      property: typedProperty,
      message: detailsMessage,
    });

    // The lead is being handled now — clear the chatbot's "Talk to an
    // Agent" handoff so the thread stops reading as pending. Fire and
    // forget: it is bookkeeping, and failing it must not fail an
    // approval whose message already went out.
    if (outcome.conversationId) {
      await supabaseAdmin()
        .from('conversations')
        .update({ status: 'open', updated_at: new Date().toISOString() })
        .eq('id', outcome.conversationId)
        .eq('account_id', ctx.accountId)
        .eq('status', 'pending');
    }

    return NextResponse.json({
      data: {
        approved: true,
        sent: outcome.sent,
        ...(outcome.channel ? { channel: outcome.channel } : {}),
        property: typedProperty,
        details_message: detailsMessage,
        conversation_id: outcome.conversationId,
        ...(outcome.sent ? {} : { template_status: outcome.templateStatus ?? 'NONE' }),
        // A hard send failure is reported alongside the approval rather
        // than as a 5xx: the contact IS active now, and telling the
        // client "approve failed" would invite a retry that re-sends.
        ...(outcome.error ? { send_error: outcome.error } : {}),
      },
    });
  } catch (err) {
    console.error('[POST /api/contacts/[id]/approve] Unexpected error:', err);
    return toErrorResponse(err);
  }
}
