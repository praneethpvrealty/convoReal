import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import type { MatchEvent, Property } from '@/types';

// POST /api/radar/send
// Body: { eventId: string, targetIds: string[] }
//
// One-tap send for a Match Radar event:
//   - kind 'new_property': targetIds are contact ids → each gets the
//     property (first photo + details + showcase link).
//   - kind 'buyer_updated': targetIds are property ids → the event's
//     contact gets one message per selected property.
//
// WhatsApp constraint honored per recipient: free-form messages are only
// deliverable inside the 24-hour customer-service window (the recipient
// messaged you in the last 24h). Recipients outside the window are NOT
// sent to; they come back as `windowClosed` so the UI can route the agent
// to the share dialog's template flow instead. This keeps Radar's one-tap
// honest instead of silently failing at Meta.

function adminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

function formatPriceINR(amount: number): string {
  if (!amount || isNaN(amount)) return '';
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2).replace(/\.00$/, '')} Lakhs`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

function propertyMessage(p: Property, baseUrl: string, visitorContactId: string): string {
  const lines = [`🏠 *${p.title}*`];
  const price = formatPriceINR(Number(p.price));
  if (price) lines.push(`💰 *Price:* ${price}`);
  const loc = [p.sublocality, p.city].filter(Boolean).join(', ') || p.location;
  if (loc) lines.push(`📍 *Location:* ${loc}`);
  if (p.bedrooms) lines.push(`🛏️ *BHK:* ${p.bedrooms} BHK`);
  if (p.area_sqft) lines.push(`📐 *Area:* ${p.area_sqft} ${p.area_unit || 'Sq.Ft.'}`);
  // v= attributes Showcase Pulse engagement to this contact (never filters)
  lines.push('', `👇 *Click the link below to view photos, location map, and full details:*`, `${baseUrl}/?property_id=${p.id}&v=${visitorContactId}`);
  return lines.join('\n');
}

/** True when the contact messaged us within the 24h service window. */
async function isSessionOpen(
  db: ReturnType<typeof adminClient>,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  const { data: conv } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();
  if (!conv) return false;

  const since = new Date(Date.now() - SESSION_WINDOW_MS).toISOString();
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conv.id)
    .eq('sender_type', 'customer')
    .gte('created_at', since);
  return (count ?? 0) > 0;
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(`radar:send:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { eventId?: string; targetIds?: string[] }
      | null;
    const eventId = body?.eventId;
    const targetIds = Array.isArray(body?.targetIds)
      ? body!.targetIds!.filter((t) => typeof t === 'string').slice(0, 20)
      : [];

    if (!eventId || targetIds.length === 0) {
      return NextResponse.json({ error: 'eventId and targetIds are required' }, { status: 400 });
    }

    // Load event through the RLS-scoped client — proves it belongs to the
    // caller's account before any service-role work happens.
    const { data: event, error: eventErr } = await ctx.supabase
      .from('match_events')
      .select('*')
      .eq('id', eventId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (eventErr) throw eventErr;
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const typedEvent = event as MatchEvent;
    // Only send to targets that were actually part of the computed event —
    // the client can narrow the selection but never widen it.
    const validTargetIds = new Set(typedEvent.matches.map((m) => m.id));
    const targets = targetIds.filter((id) => validTargetIds.has(id));
    if (targets.length === 0) {
      return NextResponse.json({ error: 'No valid targets for this event' }, { status: 400 });
    }

    const db = adminClient();
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const results: Array<{
      id: string;
      status: 'sent' | 'windowClosed' | 'failed';
      error?: string;
    }> = [];

    if (typedEvent.kind === 'new_property') {
      if (!typedEvent.property_id) {
        return NextResponse.json({ error: 'Event has no property' }, { status: 400 });
      }
      const { data: property } = await db
        .from('properties')
        .select('*')
        .eq('id', typedEvent.property_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!property) {
        return NextResponse.json({ error: 'Property no longer exists' }, { status: 410 });
      }
      const typedProperty = property as Property;
      const firstImage = (typedProperty.images || []).find((img) => img && img.trim());

      for (const contactId of targets) {
        const open = await isSessionOpen(db, ctx.accountId, contactId);
        if (!open) {
          results.push({ id: contactId, status: 'windowClosed' });
          continue;
        }
        const text = propertyMessage(typedProperty, baseUrl, contactId);
        if (firstImage) {
          await sendWhatsAppMessageAndPersist({
            accountId: ctx.accountId,
            userId: ctx.userId,
            contactId,
            kind: 'media',
            mediaKind: 'image',
            mediaLink: firstImage,
            mediaCaption: typedProperty.title,
            senderType: 'agent',
          });
        }
        const res = await sendWhatsAppMessageAndPersist({
          accountId: ctx.accountId,
          userId: ctx.userId,
          contactId,
          kind: 'text',
          text,
          senderType: 'agent',
        });
        results.push(
          res.success
            ? { id: contactId, status: 'sent' }
            : { id: contactId, status: 'failed', error: res.error },
        );
      }
    } else {
      // buyer_updated: send each selected property to the event's contact
      if (!typedEvent.contact_id) {
        return NextResponse.json({ error: 'Event has no contact' }, { status: 400 });
      }
      const open = await isSessionOpen(db, ctx.accountId, typedEvent.contact_id);
      if (!open) {
        return NextResponse.json({
          results: targets.map((id) => ({ id, status: 'windowClosed' as const })),
          sent: 0,
          windowClosed: targets.length,
          failed: 0,
        });
      }

      const { data: properties } = await db
        .from('properties')
        .select('*')
        .eq('account_id', ctx.accountId)
        .in('id', targets);

      for (const property of (properties || []) as Property[]) {
        const firstImage = (property.images || []).find((img) => img && img.trim());
        if (firstImage) {
          await sendWhatsAppMessageAndPersist({
            accountId: ctx.accountId,
            userId: ctx.userId,
            contactId: typedEvent.contact_id,
            kind: 'media',
            mediaKind: 'image',
            mediaLink: firstImage,
            mediaCaption: property.title,
            senderType: 'agent',
          });
        }
        const res = await sendWhatsAppMessageAndPersist({
          accountId: ctx.accountId,
          userId: ctx.userId,
          contactId: typedEvent.contact_id,
          kind: 'text',
          text: propertyMessage(property, baseUrl, typedEvent.contact_id),
          senderType: 'agent',
        });
        results.push(
          res.success
            ? { id: property.id, status: 'sent' }
            : { id: property.id, status: 'failed', error: res.error },
        );
      }
    }

    const sent = results.filter((r) => r.status === 'sent').length;
    const windowClosed = results.filter((r) => r.status === 'windowClosed').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    if (sent > 0) {
      await db
        .from('match_events')
        .update({
          status: 'sent',
          sent_count: (typedEvent.sent_count || 0) + sent,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', typedEvent.id)
        .eq('account_id', ctx.accountId);
    }

    return NextResponse.json({ results, sent, windowClosed, failed });
  } catch (err) {
    console.error('[POST /api/radar/send] Unexpected error:', err);
    return toErrorResponse(err);
  }
}
