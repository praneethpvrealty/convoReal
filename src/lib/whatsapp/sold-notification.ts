import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { formatShareAmount } from '@/lib/share-message-builder';
import { decrypt } from '@/lib/whatsapp/encryption';
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder';
import {
  SOLD_UPDATE_TEMPLATE_NAME,
  buildSoldUpdateTemplatePayload,
  buildSoldUpdateParams,
} from '@/lib/whatsapp/sold-update-template';
import type { MessageTemplate } from '@/types';

export const SOLD_PRICE_BUTTON_PREFIX = 'sold_price:';
export const SOLD_SIMILAR_BUTTON_PREFIX = 'sold_similar:';

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function buildSoldNotificationBody(title: string): string {
  return (
    `🔔 *Update on a property you showed interest in*\n\n` +
    `*${title}*\n\n` +
    `This property is no longer available — it has been sold.`
  );
}

export function buildSoldPriceReply(
  title: string,
  soldPrice: number | null | undefined,
  currency: string = 'INR'
): string {
  const formatted = formatShareAmount(soldPrice, currency);
  if (!formatted) {
    return `The final sale price for *${title}* hasn't been disclosed — the price is hidden.`;
  }
  return `💰 *${title}* was sold for *${formatted}*.`;
}

/** Unions the interest sources into one contact-id list, dropping
 *  duplicates and the property's own owner. */
export function dedupeAudience(
  lists: string[][],
  excludeContactId?: string | null
): string[] {
  const seen = new Set<string>();
  const audience: string[] = [];
  for (const list of lists) {
    for (const id of list) {
      if (!id || id === excludeContactId || seen.has(id)) continue;
      seen.add(id);
      audience.push(id);
    }
  }
  return audience;
}

/** True when the contact messaged us within the 24h service window
 *  (same check as the radar sender). */
async function isSessionOpen(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string
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

function resolveTemplateBodyText(bodyTemplateText: string, params: string[]): string {
  return bodyTemplateText.replace(/\{\{(\d+)\}\}/g, (match, numberStr) => {
    const idx = parseInt(numberStr) - 1;
    return idx >= 0 && idx < params.length ? params[idx] : match;
  });
}

/**
 * Returns the APPROVED property_sold_update template for the account, or
 * null when it isn't usable yet. When the account has no row for it at
 * all, auto-submits the predefined payload to Meta (fire-once seeding —
 * the first sale creates it, later sales send through it once approved).
 * PENDING/REJECTED/DRAFT rows are left alone so a rejection never loops.
 */
async function ensureSoldUpdateTemplate(
  accountId: string
): Promise<MessageTemplate | null> {
  const db = supabaseAdmin();

  const { data: latestRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', SOLD_UPDATE_TEMPLATE_NAME)
    .order('last_submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestRow) {
    const template = latestRow as unknown as MessageTemplate;
    return template.status === 'APPROVED' ? template : null;
  }

  try {
    const { data: config } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    if (!config?.waba_id || !config.access_token || config.integration_type === 'sandbox') {
      return null;
    }

    const { data: account } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .maybeSingle();
    if (!account?.owner_user_id) return null;

    const payload = buildSoldUpdateTemplatePayload();
    const meta = await submitMessageTemplate({
      wabaId: config.waba_id as string,
      accessToken: decrypt(config.access_token as string),
      payload: buildMetaTemplatePayload(payload),
    });

    await db.from('message_templates').insert({
      account_id: accountId,
      user_id: account.owner_user_id,
      name: payload.name,
      category: payload.category,
      language: payload.language,
      body_text: payload.body_text,
      footer_text: payload.footer_text ?? null,
      buttons: payload.buttons ?? null,
      sample_values: payload.sample_values ?? null,
      status: normalizeStatus(meta.status),
      meta_template_id: meta.id,
      submission_error: null,
      last_submitted_at: new Date().toISOString(),
    });

    console.log(
      `[sold-notification] auto-submitted ${SOLD_UPDATE_TEMPLATE_NAME} template for account ${accountId} (status ${meta.status})`
    );
  } catch (err) {
    console.error('[sold-notification] template auto-submit failed:', err);
  }
  // Freshly submitted templates are PENDING — usable on a later sale.
  return null;
}

/**
 * Notifies every contact who showed interest in a property — or was sent
 * it over WhatsApp — that it has been sold, with buttons to check the
 * sold price or see similar listings. Interest sources: the inventory
 * form's interested-contacts links (contacts.last_inquired_property_id),
 * showcase inquiries (contact_property_inquiries), and the WhatsApp
 * share ledger (property_shares).
 *
 * Template-first delivery: contacts almost never have an open 24-hour
 * service window when a listing sells, so the pre-approved
 * property_sold_update template is the default path (its quick-reply
 * payloads route taps exactly like the free-form buttons). An open
 * window upgrades the send to the free-form interactive message. With
 * the window closed and no approved template, the contact is skipped —
 * and the template is auto-submitted for next time.
 */
export async function notifyBuyersOfSoldProperty(
  accountId: string,
  propertyId: string
): Promise<{ notified: number; viaTemplate: number; skipped: number; audience: number }> {
  const db = supabaseAdmin();

  const { data: property } = await db
    .from('properties')
    .select('id, title, owner_contact_id')
    .eq('id', propertyId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (!property) return { notified: 0, viaTemplate: 0, skipped: 0, audience: 0 };

  const [interestedRes, inquiriesRes, sharesRes] = await Promise.all([
    db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('last_inquired_property_id', propertyId),
    db
      .from('contact_property_inquiries')
      .select('contact_id')
      .eq('account_id', accountId)
      .eq('property_id', propertyId),
    db
      .from('property_shares')
      .select('contact_id')
      .eq('account_id', accountId)
      .eq('property_id', propertyId),
  ]);

  const audience = dedupeAudience(
    [
      ((interestedRes.data ?? []) as { id: string }[]).map((r) => r.id),
      ((inquiriesRes.data ?? []) as { contact_id: string }[]).map((r) => r.contact_id),
      ((sharesRes.data ?? []) as { contact_id: string }[]).map((r) => r.contact_id),
    ],
    property.owner_contact_id as string | null
  );

  if (audience.length === 0) return { notified: 0, viaTemplate: 0, skipped: 0, audience: 0 };

  const template = await ensureSoldUpdateTemplate(accountId);

  const { data: contactRows } = await db
    .from('contacts')
    .select('id, name')
    .eq('account_id', accountId)
    .in('id', audience);
  const nameById = new Map(
    ((contactRows ?? []) as { id: string; name: string | null }[]).map((c) => [c.id, c.name])
  );

  const title = (property.title as string) || 'Property';
  const body = buildSoldNotificationBody(title);
  const buttons = [
    { id: `${SOLD_PRICE_BUTTON_PREFIX}${propertyId}`, title: 'Check sold price' },
    { id: `${SOLD_SIMILAR_BUTTON_PREFIX}${propertyId}`, title: 'Find similar' },
  ];

  let notified = 0;
  let viaTemplate = 0;
  let skipped = 0;

  for (const contactId of audience) {
    const open = await isSessionOpen(db, accountId, contactId);

    if (open) {
      const result = await sendWhatsAppMessageAndPersist({
        accountId,
        contactId,
        kind: 'interactive',
        interactiveType: 'buttons',
        interactiveBody: body,
        interactiveButtons: buttons,
        senderType: 'bot',
      });
      if (result.success) notified++;
      continue;
    }

    if (!template) {
      skipped++;
      continue;
    }

    const bodyParams = truncateParametersToBudget(
      template.body_text,
      buildSoldUpdateParams(nameById.get(contactId) ?? null, title)
    );
    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      contactId,
      kind: 'template',
      senderType: 'bot',
      templateName: template.name,
      templateLanguage: template.language || 'en_US',
      templateParams: bodyParams,
      messageParams: {
        body: bodyParams,
        // Quick-reply payloads — a tap routes through the same
        // sold_price:/sold_similar: handlers as the free-form buttons.
        buttonParams: {
          0: `${SOLD_PRICE_BUTTON_PREFIX}${propertyId}`,
          1: `${SOLD_SIMILAR_BUTTON_PREFIX}${propertyId}`,
        },
      },
      templateRow: template,
      text: resolveTemplateBodyText(template.body_text, bodyParams),
    });
    if (result.success) {
      notified++;
      viaTemplate++;
    }
  }

  console.log(
    `[sold-notification] property ${propertyId}: notified ${notified}/${audience.length} ` +
      `(${viaTemplate} via template, ${skipped} skipped — window closed, template not approved yet)`
  );
  return { notified, viaTemplate, skipped, audience: audience.length };
}
