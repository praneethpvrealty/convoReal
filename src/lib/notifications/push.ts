// ============================================================
// Expo push delivery — the mobile arm of the notification
// fan-out. Tokens are registered by the Expo app into
// notification_devices; here we look up a recipient's tokens and
// hand them to Expo's push service. Best-effort: every failure is
// swallowed and logged so a dead token or an Expo outage never
// breaks the in-app / WhatsApp channels.
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data?: Record<string, unknown>;
}

/** Send a push to every registered device of a user. Returns the
 *  number of tokens targeted (0 when the user has no devices). */
export async function sendExpoPush(userId: string, payload: PushPayload): Promise<number> {
  const admin = supabaseAdmin();
  const { data: devices } = await admin
    .from('notification_devices')
    .select('expo_push_token')
    .eq('user_id', userId);

  const tokens = (devices || [])
    .map((d) => d.expo_push_token as string)
    .filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken'));
  if (tokens.length === 0) return 0;

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    sound: 'default',
    data: payload.data,
  }));

  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.error('[push] Expo push rejected:', res.status, await res.text().catch(() => ''));
      return 0;
    }
    // Prune tokens Expo reports as unregistered so we stop pushing to
    // uninstalled apps.
    const json = (await res.json().catch(() => null)) as { data?: Array<{ status?: string; details?: { error?: string } }> } | null;
    const receipts = json?.data;
    if (Array.isArray(receipts)) {
      const dead = receipts
        .map((r, i) => (r?.status === 'error' && r?.details?.error === 'DeviceNotRegistered' ? tokens[i] : null))
        .filter((t): t is string => t !== null);
      if (dead.length > 0) {
        await admin.from('notification_devices').delete().in('expo_push_token', dead);
      }
    }
    return tokens.length;
  } catch (err) {
    console.error('[push] Expo push error:', err);
    return 0;
  }
}
