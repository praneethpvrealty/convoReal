import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder';
import {
  PROPERTY_SHARE_TEMPLATE_NAMES,
  pickPropertyShareTemplate,
  propertyShareParams,
  shareHeaderImage,
} from '@/lib/whatsapp/property-share-template';
import {
  resolveSendLanguage,
  isLanguageFallback,
  warnLanguageFallback,
} from '@/lib/whatsapp/template-language';
import {
  accountBrandImage,
  accountBrandName,
} from '@/lib/showcase/account-showcase-url';
import type { MatchEvent, MessageTemplate, Property } from '@/types';

// POST /api/radar/send
// Body: { eventId: string, targetIds: string[] }
//
// One-tap send for a Match Radar event:
//   - kind 'new_property': targetIds are contact ids → each gets the
//     property (first photo + details + showcase link).
//   - kind 'buyer_updated': targetIds are property ids → the event's
//     contact gets one message per selected property.
//
// Channel selection per recipient (template-first strategy): radar
// targets almost never have an open 24-hour service window — they're
// matched buyers, not active chats — so the pre-approved
// property-details template is the default delivery path. An open
// window upgrades the send to the richer free-form message (photo +
// full details). Only when the window is closed AND the template isn't
// approved yet does a recipient come back unsent (`templateMissing`),
// and the UI offers the one-click template setup.

function adminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

// Same local helper as the broadcast route / broadcasts sender — renders
// the template body with params for the persisted message text.
function resolveTemplateBodyText(bodyTemplateText: string, params: string[]) {
  return bodyTemplateText.replace(/\{\{(\d+)\}\}/g, (match, numberStr) => {
    const idx = parseInt(numberStr) - 1;
    return idx >= 0 && idx < params.length ? params[idx] : match;
  });
}

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

    const limit = await checkRateLimit(`radar:send:${ctx.userId}`, RATE_LIMITS.adminAction);
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
      status: 'sent' | 'templateMissing' | 'failed';
      channel?: 'freeform' | 'template';
      error?: string;
    }> = [];

    // Latest approved alert template (template-first channel). The
    // latest row of ANY status is also surfaced so the UI can tell
    // "not created yet" apart from "pending Meta approval".
    const { data: templateRows } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', ctx.accountId)
      .in('name', PROPERTY_SHARE_TEMPLATE_NAMES)
      .order('last_submitted_at', { ascending: false, nullsFirst: false });
    const candidates = (templateRows || []) as MessageTemplate[];
    const latestTemplate = candidates[0] ?? null;
    // One lookup for the whole batch — the brand card is per account,
    // and only the property photo varies from alert to alert.
    const [brandImage, brandName] = await Promise.all([
      accountBrandImage(db, ctx.accountId),
      accountBrandName(db, ctx.accountId),
    ]);
    /** Whether ANY of these alerts can go out at all, for the
     *  "templateMissing" report — the per-property choice happens at
     *  send time, once the header image is known. */
    const anyApproved = pickPropertyShareTemplate(candidates, { hasImage: true })
      ?? pickPropertyShareTemplate(candidates, { hasImage: false });

    /** One alert to one contact: free-form when the window is open,
     *  template otherwise. */
    const sendAlert = async (
      contactId: string,
      contactName: string | null,
      property: Property,
    ): Promise<{ status: 'sent' | 'templateMissing' | 'failed'; channel?: 'freeform' | 'template'; error?: string }> => {
      const open = await isSessionOpen(db, ctx.accountId, contactId);

      if (open) {
        const firstImage = (property.images || []).find((img) => img && img.trim());
        if (firstImage) {
          await sendWhatsAppMessageAndPersist({
            accountId: ctx.accountId,
            userId: ctx.userId,
            contactId,
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
          contactId,
          kind: 'text',
          text: propertyMessage(property, baseUrl, contactId),
          senderType: 'agent',
        });
        return res.success
          ? { status: 'sent', channel: 'freeform' }
          : { status: 'failed', error: res.error };
      }

      if (!anyApproved) return { status: 'templateMissing' };

      // The listing's own photo, or the account's brand card — a
      // Radar alert used to go out as text even for a listing with
      // photos sitting right there, because this path only ever asked
      // for the text template's names.
      const headerImage = shareHeaderImage({ images: property.images, brandImage });
      const language = await resolveSendLanguage(
        ctx.supabase,
        ctx.accountId,
        contactId,
      );
      const alertTemplate = pickPropertyShareTemplate(candidates, {
        hasImage: Boolean(headerImage),
        language,
      });
      if (!alertTemplate) return { status: 'templateMissing' };
      if (isLanguageFallback(alertTemplate, language)) {
        warnLanguageFallback('radar-send', ctx.accountId, language, alertTemplate);
      }

      // Param count follows the template's name — the signed revisions
      // carry the brokerage as {{2}}, their predecessors do not.
      const params = propertyShareParams(
        alertTemplate.name,
        contactName,
        property,
        brandName,
      );
      const bodyParams = truncateParametersToBudget(alertTemplate.body_text, [...params]);
      const buttonParams: Record<number, string> = {};
      (alertTemplate.buttons ?? []).forEach((btn, idx) => {
        if (btn.type === 'URL' && btn.url.includes('{{1}}')) {
          // v= attributes portal opens to this contact in Showcase Pulse.
          buttonParams[idx] = `?property_id=${property.id}&v=${contactId}`;
        }
      });
      const res = await sendWhatsAppMessageAndPersist({
        accountId: ctx.accountId,
        userId: ctx.userId,
        contactId,
        kind: 'template',
        senderType: 'agent',
        templateName: alertTemplate.name,
        templateLanguage: alertTemplate.language || 'en_US',
        templateParams: bodyParams,
        messageParams: {
          body: bodyParams,
          ...(Object.keys(buttonParams).length > 0 ? { buttonParams } : {}),
          ...(headerImage ? { headerMediaUrl: headerImage } : {}),
        },
        templateRow: alertTemplate,
        text: resolveTemplateBodyText(alertTemplate.body_text, bodyParams),
      });
      return res.success
        ? { status: 'sent', channel: 'template' }
        : { status: 'failed', error: res.error };
    };

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

      // Contact names feed the template's {{1}} — one query for all targets.
      const { data: contactRows } = await db
        .from('contacts')
        .select('id, name')
        .eq('account_id', ctx.accountId)
        .in('id', targets);
      const nameById = new Map((contactRows || []).map((c) => [c.id as string, c.name as string | null]));

      for (const contactId of targets) {
        const outcome = await sendAlert(contactId, nameById.get(contactId) ?? null, typedProperty);
        results.push({ id: contactId, ...outcome });
      }
    } else {
      // buyer_updated: send each selected property to the event's contact
      if (!typedEvent.contact_id) {
        return NextResponse.json({ error: 'Event has no contact' }, { status: 400 });
      }

      const [{ data: contactRow }, { data: properties }] = await Promise.all([
        db
          .from('contacts')
          .select('id, name')
          .eq('account_id', ctx.accountId)
          .eq('id', typedEvent.contact_id)
          .maybeSingle(),
        db.from('properties').select('*').eq('account_id', ctx.accountId).in('id', targets),
      ]);

      for (const property of (properties || []) as Property[]) {
        const outcome = await sendAlert(
          typedEvent.contact_id,
          (contactRow?.name as string | null) ?? null,
          property,
        );
        results.push({ id: property.id, ...outcome });
      }
    }

    const sent = results.filter((r) => r.status === 'sent').length;
    const sentViaTemplate = results.filter((r) => r.channel === 'template').length;
    const templateMissing = results.filter((r) => r.status === 'templateMissing').length;
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

    return NextResponse.json({
      results,
      sent,
      sentViaTemplate,
      templateMissing,
      failed,
      // Lets the UI distinguish "template not created" from "waiting on
      // Meta approval" when templateMissing > 0.
      alertTemplateStatus: latestTemplate?.status ?? null,
    });
  } catch (err) {
    console.error('[POST /api/radar/send] Unexpected error:', err);
    return toErrorResponse(err);
  }
}
