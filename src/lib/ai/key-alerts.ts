import { supabaseAdmin } from '@/lib/supabase/admin';

import type { GeminiKey } from './gemini-keys';

export const ALERT_COOLDOWN_MS = 6 * 60 * 60_000;
const SETTING_KEY = 'ai_key_alerts';
const recent = new Map<string, number>();

export function shouldAlert(
  lastAlertAt: string | number | null | undefined,
  now = Date.now()
): boolean {
  if (!lastAlertAt) return true;
  const last =
    typeof lastAlertAt === 'number'
      ? lastAlertAt
      : new Date(lastAlertAt).getTime();
  return !Number.isFinite(last) || now - last >= ALERT_COOLDOWN_MS;
}

async function claim(slot: string, keyId: string | null): Promise<boolean> {
  const now = Date.now();
  if (!shouldAlert(recent.get(slot), now)) return false;
  const db = supabaseAdmin();
  const at = new Date(now).toISOString();
  if (keyId) {
    const { data } = await db
      .from('ai_provider_keys')
      .select('last_alert_at')
      .eq('id', keyId)
      .maybeSingle();
    if (
      !shouldAlert(
        (data as { last_alert_at?: string } | null)?.last_alert_at,
        now
      )
    ) {
      recent.set(slot, now);
      return false;
    }
    await db
      .from('ai_provider_keys')
      .update({ last_alert_at: at })
      .eq('id', keyId);
  } else {
    const { data } = await db
      .from('system_settings')
      .select('value')
      .eq('key', SETTING_KEY)
      .maybeSingle();
    const value = ((data as { value?: unknown } | null)?.value ?? {}) as Record<
      string,
      string
    >;
    if (!shouldAlert(value[slot], now)) {
      recent.set(slot, now);
      return false;
    }
    await db
      .from('system_settings')
      .upsert(
        { key: SETTING_KEY, value: { ...value, [slot]: at } },
        { onConflict: 'key' }
      );
  }
  recent.set(slot, now);
  return true;
}

async function notifyPlatformAdmins(
  title: string,
  body: string
): Promise<number> {
  const { data } = await supabaseAdmin()
    .from('profiles')
    .select('user_id, account_id')
    .eq('role', 'super_admin');
  const admins = (data ?? []) as Array<{
    user_id: string;
    account_id: string | null;
  }>;
  const { createNotification } = await import('@/lib/notifications/create');
  let sent = 0;
  for (const admin of admins) {
    if (!admin.account_id) continue;
    await createNotification({
      accountId: admin.account_id,
      userId: admin.user_id,
      type: 'ai_key_alert',
      title,
      body,
      link: '/admin',
      channels: { inApp: true, whatsapp: true, push: true },
    });
    sent += 1;
  }
  return sent;
}

export async function alertKeyExhausted(
  entry: Pick<GeminiKey, 'id' | 'label' | 'scope'>,
  message: string
): Promise<boolean> {
  try {
    if (!(await claim(`key:${entry.label}`, entry.id))) return false;
    await notifyPlatformAdmins(
      `Gemini key "${entry.label}" has run out`,
      `${message.slice(0, 200)}\n\nThe next key takes over automatically. Top up or replace it in Admin → AI keys.`
    );
    return true;
  } catch (err) {
    console.error('[ai-key-alerts] exhausted alert failed:', err);
    return false;
  }
}

export async function alertAllKeysResting(
  labels: string[],
  reason: string | null
): Promise<boolean> {
  try {
    if (!(await claim('all', null))) return false;
    await notifyPlatformAdmins(
      'Every Gemini key is resting',
      `AI features are failing until a key recovers or a new one is added in Admin → AI keys. Keys: ${labels.join(', ')}.${reason ? `\n\nLast error: ${reason.slice(0, 200)}` : ''}`
    );
    return true;
  } catch (err) {
    console.error('[ai-key-alerts] all-resting alert failed:', err);
    return false;
  }
}

export function resetKeyAlertState(): void {
  recent.clear();
}
