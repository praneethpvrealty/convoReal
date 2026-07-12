// ============================================================
// WhatsApp delivery for the admin plan-override OTP step-up.
//
// Mirrors the sender-resolution logic in src/app/api/auth/sms-hook/
// route.ts (login OTP delivery) exactly: always use the platform's
// designated sender — the earliest super_admin account's WhatsApp
// config, falling back to system_settings.fallback_whatsapp_account_id,
// then any Official API config, then sandbox. This is deliberately
// NOT "the acting admin's own account's config" — that account may not
// have WhatsApp configured at all, whereas the platform sender is
// already proven reliable for OTP delivery.
//
// Sends via the approved 'whatsapp_otp' template first (works outside
// the 24-hour customer-service window that free-form text requires),
// falling back to free-form text only if the template send fails.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/whatsapp/encryption";
import { sendTemplateMessage, sendTextMessage } from "@/lib/whatsapp/meta-api";
import { getSandboxSystemConfig } from "@/lib/system-settings";

interface WhatsappConfigRow {
  account_id: string;
  phone_number_id: string | null;
  access_token: string | null;
  integration_type: string | null;
}

/**
 * Sends a 6-digit code to `toPhone` over WhatsApp. Returns false (never
 * throws) on any failure — the caller decides how to surface that to
 * the admin waiting on the code.
 */
export async function sendAdminOtpCode(
  admin: SupabaseClient,
  args: { toPhone: string; code: string },
): Promise<boolean> {
  try {
    const [adminProfilesRes, settingsRes, configsRes] = await Promise.all([
      admin
        .from("profiles")
        .select("account_id")
        .eq("role", "super_admin")
        .order("created_at", { ascending: true })
        .limit(1),
      admin
        .from("system_settings")
        .select("value")
        .eq("key", "fallback_whatsapp_account_id")
        .maybeSingle(),
      admin
        .from("whatsapp_config")
        .select("account_id, phone_number_id, access_token, integration_type"),
    ]);

    if (adminProfilesRes.error || settingsRes.error || configsRes.error) {
      console.error("[admin-otp-sender] failed to load sender config:", {
        adminProfilesError: adminProfilesRes.error,
        settingsError: settingsRes.error,
        configsError: configsRes.error,
      });
      return false;
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
        (c) => c.integration_type === "official_api" && c.phone_number_id && c.access_token,
      );
    }
    if (!senderConfig) {
      senderConfig = configs.find(
        (c) => c.integration_type === "sandbox" && c.phone_number_id && c.access_token,
      );
    }
    if (!senderConfig) {
      console.error("[admin-otp-sender] no valid WhatsApp sender configured");
      return false;
    }

    let phoneNumberId: string;
    let decryptedToken: string;
    if (senderConfig.integration_type === "sandbox") {
      const sandboxSystem = await getSandboxSystemConfig();
      if (!sandboxSystem.enabled || !sandboxSystem.access_token || !sandboxSystem.phone_number_id) {
        console.error("[admin-otp-sender] sandbox sender not configured");
        return false;
      }
      phoneNumberId = sandboxSystem.phone_number_id;
      decryptedToken = decrypt(sandboxSystem.access_token);
    } else {
      if (!senderConfig.phone_number_id || !senderConfig.access_token) {
        console.error("[admin-otp-sender] Official API sender missing credentials");
        return false;
      }
      phoneNumberId = senderConfig.phone_number_id;
      decryptedToken = decrypt(senderConfig.access_token);
    }

    const cleanPhone = args.toPhone.replace("+", "");

    try {
      try {
        await sendTemplateMessage({
          phoneNumberId,
          accessToken: decryptedToken,
          to: cleanPhone,
          templateName: "whatsapp_otp",
          language: "en",
          messageParams: {
            body: [args.code],
            buttonParams: { 0: args.code },
          },
        });
      } catch (buttonError) {
        console.warn(
          "[admin-otp-sender] template with button param failed, retrying body-only:",
          buttonError,
        );
        await sendTemplateMessage({
          phoneNumberId,
          accessToken: decryptedToken,
          to: cleanPhone,
          templateName: "whatsapp_otp",
          language: "en",
          params: [args.code],
        });
      }
      return true;
    } catch (templateError) {
      console.warn(
        "[admin-otp-sender] template send failed, falling back to free-form text:",
        templateError,
      );
      try {
        await sendTextMessage({
          phoneNumberId,
          accessToken: decryptedToken,
          to: cleanPhone,
          text: `Your ConvoReal admin verification code is: *${args.code}*\n\nUse it to confirm a plan change. Valid for 10 minutes. If you didn't request this, ignore this message.`,
        });
        return true;
      } catch (fallbackError) {
        console.error("[admin-otp-sender] fallback text send failed:", fallbackError);
        return false;
      }
    }
  } catch (err) {
    console.error("[admin-otp-sender] unexpected error:", err);
    return false;
  }
}
