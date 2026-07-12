import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTransactionalEmail, buildImageCleanupWarningEmail } from '@/lib/email';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';

/**
 * Warns an account's owner (org_manager) that images for some dormant
 * listings are scheduled for archival. Sends BOTH an email and a WhatsApp
 * summary — one message each per account per run, not one per property.
 *
 * Entirely non-fatal: notification failures must never block the cleanup
 * state machine (mirrors the posture in src/lib/credits/notify.ts).
 */

interface OwnerProfile {
  user_id: string;
  phone: string | null;
  email: string | null;
  full_name: string | null;
}

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://app.convoreal.com';

async function getOwner(
  admin: SupabaseClient,
  accountId: string,
): Promise<OwnerProfile | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('user_id, phone, email, full_name')
    .eq('account_id', accountId)
    .eq('org_role', 'org_manager')
    .maybeSingle();
  if (error || !data) return null;
  return data as OwnerProfile;
}

export async function notifyOwnerImageCleanup(
  admin: SupabaseClient,
  accountId: string,
  properties: { title: string }[],
  archiveDate: Date,
): Promise<void> {
  if (properties.length === 0) return;
  let owner: OwnerProfile | null = null;
  try {
    owner = await getOwner(admin, accountId);
  } catch (err) {
    console.error('[image-cleanup] owner lookup failed (non-fatal):', err);
    return;
  }
  if (!owner) return;

  const tenantName = owner.full_name || 'there';
  const count = properties.length;
  const dateStr = archiveDate.toLocaleDateString();
  const noun = count === 1 ? 'property' : 'properties';

  // Email
  if (owner.email) {
    try {
      const { subject, html, text } = buildImageCleanupWarningEmail({
        tenantName,
        properties,
        archiveDate: archiveDate.toISOString(),
        inventoryUrl: `${appUrl}/inventory`,
      });
      await sendTransactionalEmail({ to: owner.email, subject, html, text });
    } catch (err) {
      console.error('[image-cleanup] warning email failed (non-fatal):', err);
    }
  }

  // WhatsApp
  if (owner.phone) {
    try {
      const text =
        `🗂️ ConvoReal: photos for ${count} old ${noun} (Sold/Archived/off-market) ` +
        `will be archived on ${dateStr} to free up storage. ` +
        `Re-activate a listing to keep its photos, or restore them anytime from Inventory: ${appUrl}/inventory`;
      const result = await sendWhatsAppMessageAndPersist({
        accountId,
        userId: owner.user_id,
        toPhone: owner.phone,
        kind: 'text',
        senderType: 'bot',
        text,
      });
      if (!result.success) {
        console.warn(
          `[image-cleanup] warning WhatsApp failed (non-fatal): ${result.error}`,
        );
      }
    } catch (err) {
      console.error('[image-cleanup] warning WhatsApp exception (non-fatal):', err);
    }
  }
}
