// ============================================================
// The PLATFORM's own WhatsApp sender — the number ConvoReal itself
// messages users from, as opposed to a tenant messaging their own
// contacts from their own WABA.
//
// Anything the operator says to a customer goes out from here: admin
// OTP step-up codes, and the apology / goodwill notice that accompanies
// a subscription extension. Using the tenant's own config would be
// wrong for both — the tenant may have no WhatsApp configured at all,
// and during an outage their config is quite possibly the broken thing.
//
// Resolution order mirrors src/app/api/auth/sms-hook/route.ts (login
// OTP delivery): the earliest super_admin account's config, then
// system_settings.fallback_whatsapp_account_id, then any Official API
// config, then sandbox.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendTemplateMessage, sendTextMessage } from '@/lib/whatsapp/meta-api';
import { getSandboxSystemConfig } from '@/lib/system-settings';

interface WhatsappConfigRow {
  account_id: string;
  phone_number_id: string | null;
  access_token: string | null;
  integration_type: string | null;
}

export interface PlatformSender {
  phoneNumberId: string;
  accessToken: string;
}

/** Resolves and decrypts the platform sender's credentials, or null when
 *  none is usable. Never throws. */
export async function resolvePlatformSender(
  admin: SupabaseClient
): Promise<PlatformSender | null> {
  try {
    const [adminProfilesRes, settingsRes, configsRes] = await Promise.all([
      admin
        .from('profiles')
        .select('account_id')
        .eq('role', 'super_admin')
        .order('created_at', { ascending: true })
        .limit(1),
      admin
        .from('system_settings')
        .select('value')
        .eq('key', 'fallback_whatsapp_account_id')
        .maybeSingle(),
      admin
        .from('whatsapp_config')
        .select('account_id, phone_number_id, access_token, integration_type'),
    ]);

    if (adminProfilesRes.error || settingsRes.error || configsRes.error) {
      console.error('[platform-sender] failed to load sender config:', {
        adminProfilesError: adminProfilesRes.error,
        settingsError: settingsRes.error,
        configsError: configsRes.error,
      });
      return null;
    }

    const configs = (configsRes.data ?? []) as WhatsappConfigRow[];
    const otpSenderAccountId = adminProfilesRes.data?.[0]
      ? (adminProfilesRes.data[0] as { account_id: string }).account_id
      : null;
    const fallbackAccountId =
      (settingsRes.data as { value?: string | null } | null)?.value ?? null;

    let senderConfig = configs.find((c) => c.account_id === otpSenderAccountId);
    if (!senderConfig && fallbackAccountId) {
      senderConfig = configs.find((c) => c.account_id === fallbackAccountId);
    }
    if (!senderConfig) {
      senderConfig = configs.find(
        (c) =>
          c.integration_type === 'official_api' &&
          c.phone_number_id &&
          c.access_token
      );
    }
    if (!senderConfig) {
      senderConfig = configs.find(
        (c) =>
          c.integration_type === 'sandbox' &&
          c.phone_number_id &&
          c.access_token
      );
    }
    if (!senderConfig) {
      console.error('[platform-sender] no valid WhatsApp sender configured');
      return null;
    }

    if (senderConfig.integration_type === 'sandbox') {
      const sandboxSystem = await getSandboxSystemConfig();
      if (
        !sandboxSystem.enabled ||
        !sandboxSystem.access_token ||
        !sandboxSystem.phone_number_id
      ) {
        console.error('[platform-sender] sandbox sender not configured');
        return null;
      }
      return {
        phoneNumberId: sandboxSystem.phone_number_id,
        accessToken: decrypt(sandboxSystem.access_token),
      };
    }

    if (!senderConfig.phone_number_id || !senderConfig.access_token) {
      console.error(
        '[platform-sender] Official API sender missing credentials'
      );
      return null;
    }
    return {
      phoneNumberId: senderConfig.phone_number_id,
      accessToken: decrypt(senderConfig.access_token),
    };
  } catch (err) {
    console.error('[platform-sender] unexpected error:', err);
    return null;
  }
}

export interface PlatformTemplateSend {
  toPhone: string;
  templateName: string;
  params: string[];
  /** Free-form body used only if the template send fails — typically
   *  because the template is not approved on the platform WABA yet. It
   *  only reaches a user with an open 24-hour service window, which is
   *  why the template is always tried first. */
  fallbackText: string;
}

/**
 * Sends a template from the platform sender, falling back to free-form
 * text. Returns which path succeeded so the caller can record it.
 * Never throws.
 */
export async function sendPlatformTemplate(
  admin: SupabaseClient,
  args: PlatformTemplateSend
): Promise<{ sent: boolean; via: 'template' | 'text' | null; error?: string }> {
  const sender = await resolvePlatformSender(admin);
  if (!sender) return { sent: false, via: null, error: 'no_platform_sender' };

  const to = args.toPhone.replace('+', '');

  try {
    await sendTemplateMessage({
      phoneNumberId: sender.phoneNumberId,
      accessToken: sender.accessToken,
      to,
      templateName: args.templateName,
      language: 'en',
      params: args.params,
    });
    return { sent: true, via: 'template' };
  } catch (templateError) {
    console.warn(
      `[platform-sender] template ${args.templateName} failed, falling back to free-form text:`,
      templateError
    );
    try {
      await sendTextMessage({
        phoneNumberId: sender.phoneNumberId,
        accessToken: sender.accessToken,
        to,
        text: args.fallbackText,
      });
      return { sent: true, via: 'text' };
    } catch (fallbackError) {
      const error =
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
      console.error('[platform-sender] fallback text send failed:', error);
      return { sent: false, via: null, error };
    }
  }
}
