// ============================================================
// Resolves the channels a notification should fire on for a given
// account + event, layering the account's saved overrides (from the
// notification_preferences table) over the event's built-in defaults.
// "App" maps to both the in-app bell and mobile push.
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getNotificationEvent } from '@/lib/notifications/events';
import type { NotificationChannels } from '@/lib/notifications/create';

export async function resolveChannels(
  accountId: string,
  eventKey: string
): Promise<NotificationChannels> {
  const event = getNotificationEvent(eventKey);
  // Unknown key: fire everywhere rather than silently dropping.
  let app = event?.defaults.app ?? true;
  let whatsapp = event?.defaults.whatsapp ?? true;

  try {
    const { data } = await supabaseAdmin()
      .from('notification_preferences')
      .select('app_enabled, whatsapp_enabled')
      .eq('account_id', accountId)
      .eq('event_key', eventKey)
      .maybeSingle();
    if (data) {
      app = data.app_enabled as boolean;
      whatsapp = data.whatsapp_enabled as boolean;
    }
  } catch (err) {
    // On any lookup failure fall back to defaults — never block the
    // notification on a preferences read.
    console.error('[notify] preference lookup failed, using defaults:', err);
  }

  return { inApp: app, push: app, whatsapp };
}
