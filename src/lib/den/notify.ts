// ============================================================
// Owners Den — WhatsApp notification helper (server-only).
//
// One consistent, best-effort delivery ladder for Den events (match
// alerts, bid notifications), always through the RECIPIENT's managing
// agency sender:
//   1. free-form text when the contact's 24h session is open
//   2. else the named template if the account has it APPROVED
//   3. else silent skip — the in-app surface (radar card / Den inbox)
//      still shows the event, we just don't have a channel to push
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageTemplate } from "@/types";
import { sendWhatsAppMessageAndPersist } from "@/lib/whatsapp/meta-api-dispatcher";

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function isSessionOpen(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  const { data: conv } = await db
    .from("conversations")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (!conv) return false;
  const since = new Date(Date.now() - SESSION_WINDOW_MS).toISOString();
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conv.id)
    .eq("sender_type", "customer")
    .gte("created_at", since);
  return (count ?? 0) > 0;
}

export async function approvedTemplate(
  db: SupabaseClient,
  accountId: string,
  templateName: string,
): Promise<MessageTemplate | null> {
  const { data: row } = await db
    .from("message_templates")
    .select("*")
    .eq("account_id", accountId)
    .eq("name", templateName)
    .order("last_submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const template = row as MessageTemplate | null;
  return template?.status === "APPROVED" ? template : null;
}

/**
 * Session-first, template-fallback send. Returns true when a message
 * actually went out. Never throws.
 */
export async function sendDenNotification(
  db: SupabaseClient,
  args: {
    accountId: string;
    contactId: string;
    text: string;
    templateName?: string;
    templateParams?: string[];
  },
): Promise<boolean> {
  try {
    const open = await isSessionOpen(db, args.accountId, args.contactId);
    if (open) {
      const res = await sendWhatsAppMessageAndPersist({
        accountId: args.accountId,
        contactId: args.contactId,
        kind: "text",
        senderType: "bot",
        text: args.text,
      });
      return res.success;
    }

    if (!args.templateName || !args.templateParams) return false;
    const template = await approvedTemplate(db, args.accountId, args.templateName);
    if (!template) return false;

    const res = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      contactId: args.contactId,
      kind: "template",
      senderType: "bot",
      templateName: template.name,
      templateLanguage: template.language || "en_US",
      templateParams: args.templateParams,
      messageParams: { body: args.templateParams },
      templateRow: template,
      text: args.text,
    });
    return res.success;
  } catch (err) {
    console.error("[den-notify] send failed (non-fatal):", err);
    return false;
  }
}
