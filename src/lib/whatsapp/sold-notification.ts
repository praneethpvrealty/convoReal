import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { formatShareAmount } from '@/lib/share-message-builder';

export const SOLD_PRICE_BUTTON_PREFIX = 'sold_price:';
export const SOLD_SIMILAR_BUTTON_PREFIX = 'sold_similar:';

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

/**
 * Notifies every contact who showed interest in a property — or was sent
 * it over WhatsApp — that it has been sold, with buttons to check the
 * sold price or see similar listings. Interest sources: the inventory
 * form's interested-contacts links (contacts.last_inquired_property_id),
 * showcase inquiries (contact_property_inquiries), and the WhatsApp
 * share ledger (property_shares). Free-form send: contacts outside the
 * 24-hour service window fail silently per Meta rules — each send is
 * independent, so one closed window never blocks the rest.
 */
export async function notifyBuyersOfSoldProperty(
  accountId: string,
  propertyId: string
): Promise<{ notified: number; audience: number }> {
  const db = supabaseAdmin();

  const { data: property } = await db
    .from('properties')
    .select('id, title, owner_contact_id')
    .eq('id', propertyId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (!property) return { notified: 0, audience: 0 };

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

  const body = buildSoldNotificationBody((property.title as string) || 'Property');
  let notified = 0;

  for (const contactId of audience) {
    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      contactId,
      kind: 'interactive',
      interactiveType: 'buttons',
      interactiveBody: body,
      interactiveButtons: [
        { id: `${SOLD_PRICE_BUTTON_PREFIX}${propertyId}`, title: 'Check sold price' },
        { id: `${SOLD_SIMILAR_BUTTON_PREFIX}${propertyId}`, title: 'Find similar' },
      ],
      senderType: 'bot',
    });
    if (result.success) notified++;
  }

  console.log(
    `[sold-notification] property ${propertyId}: notified ${notified}/${audience.length} interested contacts`
  );
  return { notified, audience: audience.length };
}
