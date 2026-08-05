import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sendPropertyToContact } from '@/lib/whatsapp/share-property-send';
import type { Property } from '@/types';

// POST /api/whatsapp/share-property
// Body: { contact_id: string, property_id: string, message: string }
//
// One property share to one contact through the account's WhatsApp
// Business number. The template-first send rules live in
// src/lib/whatsapp/share-property-send.ts, shared with the approve
// route so the two cannot drift.

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(`share-property:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      contact_id?: string;
      property_id?: string;
      message?: string;
    } | null;
    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : '';
    const propertyId = typeof body?.property_id === 'string' ? body.property_id : '';
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!contactId || !propertyId || !message) {
      return NextResponse.json(
        { error: 'contact_id, property_id and message are required' },
        { status: 400 },
      );
    }

    // RLS-scoped loads prove both rows belong to the caller's account
    // before any service-role work happens.
    const [{ data: contact, error: contactErr }, { data: property, error: propertyErr }] =
      await Promise.all([
        ctx.supabase
          .from('contacts')
          .select('id, name')
          .eq('id', contactId)
          .eq('account_id', ctx.accountId)
          .maybeSingle(),
        ctx.supabase
          .from('properties')
          .select('*')
          .eq('id', propertyId)
          .eq('account_id', ctx.accountId)
          .maybeSingle(),
      ]);
    if (contactErr) throw contactErr;
    if (propertyErr) throw propertyErr;
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

    const outcome = await sendPropertyToContact({
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId,
      contactName: (contact.name as string | null) ?? null,
      property: property as Property,
      message,
    });

    if (outcome.error) {
      return NextResponse.json({ error: outcome.error }, { status: 502 });
    }

    return NextResponse.json({
      data: {
        sent: outcome.sent,
        ...(outcome.channel ? { channel: outcome.channel } : {}),
        conversation_id: outcome.conversationId,
        ...(outcome.sent ? {} : { template_status: outcome.templateStatus ?? 'NONE' }),
        ...(outcome.freeformError ? { freeform_error: outcome.freeformError } : {}),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
