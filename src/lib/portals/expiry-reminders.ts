// ============================================================
// Portal listing expiry nudges — paid portal listings lapse
// silently; this cron pass WhatsApps the agent a few days before
// `expires_on` so they can renew or mark the listing removed.
// One nudge per listing (expiry_reminder_sent), sent to the user
// who recorded the posting (falling back to nobody rather than
// spamming the whole account).
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { PORTALS, PORTAL_EXPIRY_REMINDER_DAYS, type PortalKey } from '@/lib/portals/post-kit';

export async function sendPortalExpiryReminders(now: Date = new Date()): Promise<void> {
  const admin = supabaseAdmin();
  const horizon = new Date(now.getTime() + PORTAL_EXPIRY_REMINDER_DAYS * 24 * 60 * 60 * 1000);

  const { data: listings, error } = await admin
    .from('property_portal_listings')
    .select('id, account_id, user_id, portal, listing_url, expires_on, property:properties(id, title, property_code)')
    .eq('status', 'active')
    .eq('expiry_reminder_sent', false)
    .not('expires_on', 'is', null)
    .lte('expires_on', horizon.toISOString().substring(0, 10));

  if (error) {
    console.error('[Portal Expiry] fetch failed:', error);
    return;
  }
  if (!listings || listings.length === 0) return;

  const userIds = [...new Set(listings.map((l) => l.user_id).filter(Boolean))] as string[];
  const { data: profiles } = await admin
    .from('profiles')
    .select('user_id, phone, full_name')
    .in('user_id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']);
  const phoneByUser = new Map(
    (profiles || [])
      .filter((p) => p.phone && isValidE164(sanitizePhoneForMeta(p.phone)))
      .map((p) => [p.user_id as string, p.phone as string])
  );

  for (const listing of listings) {
    const phone = listing.user_id ? phoneByUser.get(listing.user_id) : undefined;

    // Mark first so a failed/undeliverable nudge can't loop forever.
    await admin.from('property_portal_listings').update({ expiry_reminder_sent: true }).eq('id', listing.id);
    if (!phone) continue;

    const property = listing.property as unknown as { title: string | null; property_code: string | null } | null;
    const portalLabel = PORTALS[listing.portal as PortalKey]?.label || listing.portal;
    const expiresOn = new Date(`${listing.expires_on}T00:00:00+05:30`).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
    });

    const text = [
      `⏳ *Portal listing expiring soon*`,
      `Your ${portalLabel} ad for *${property?.title || 'a property'}*${property?.property_code ? ` (${property.property_code})` : ''} expires on *${expiresOn}*.`,
      listing.listing_url ? `🔗 ${listing.listing_url}` : null,
      '',
      'Renew it on the portal, or mark it removed from the Post to Portals dialog in Inventory.',
    ]
      .filter((l): l is string => l !== null)
      .join('\n');

    const result = await sendWhatsAppMessageAndPersist({
      accountId: listing.account_id,
      userId: listing.user_id,
      toPhone: phone,
      kind: 'text',
      senderType: 'bot',
      text,
    });
    if (!result.success) {
      console.warn(`[Portal Expiry] send failed for listing ${listing.id}:`, result.error);
    }
  }
}
