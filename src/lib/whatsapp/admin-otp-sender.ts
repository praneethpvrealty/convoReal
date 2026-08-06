// ============================================================
// WhatsApp delivery for the admin plan-override OTP step-up.
//
// Sender resolution lives in ./platform-sender — always the platform's
// designated sender, deliberately NOT "the acting admin's own account's
// config", which may not have WhatsApp configured at all.
//
// Sends via the approved 'whatsapp_otp' template first (works outside
// the 24-hour customer-service window that free-form text requires),
// falling back to free-form text only if the template send fails. The
// button-param variant is tried before the body-only one because the
// approved template carries a one-tap copy button.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplateMessage, sendTextMessage } from "@/lib/whatsapp/meta-api";
import { resolvePlatformSender } from "@/lib/whatsapp/platform-sender";

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
    const sender = await resolvePlatformSender(admin);
    if (!sender) return false;

    const { phoneNumberId, accessToken } = sender;
    const cleanPhone = args.toPhone.replace("+", "");

    try {
      try {
        await sendTemplateMessage({
          phoneNumberId,
          accessToken,
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
          accessToken,
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
          accessToken,
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
