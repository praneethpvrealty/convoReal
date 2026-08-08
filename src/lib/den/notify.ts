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

/**
 * The approved row for a template, by name — or by any of several
 * names, newest first, when the caller has a rename chain to walk.
 *
 * A renamed template ships under a name Meta has not ruled on, so for
 * a while the account holds an approved row under the OLD name and a
 * pending one under the new. Passing both lets the send keep working
 * throughout, and `pick` decides which row wins.
 */
export async function approvedTemplate(
  db: SupabaseClient,
  accountId: string,
  templateName: string | string[],
  pick?: (rows: MessageTemplate[]) => MessageTemplate | null,
): Promise<MessageTemplate | null> {
  const names = Array.isArray(templateName) ? templateName : [templateName];
  const { data: rows } = await db
    .from("message_templates")
    .select("*")
    .eq("account_id", accountId)
    .in("name", names)
    .order("last_submitted_at", { ascending: false });
  const templates = (rows || []) as MessageTemplate[];
  if (pick) return pick(templates);
  const template = templates[0] ?? null;
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
    templateName?: string | string[];
    /** Chooses among several approved candidates — see approvedTemplate. */
    pickTemplate?: (rows: MessageTemplate[]) => MessageTemplate | null;
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
    const template = await approvedTemplate(
      db,
      args.accountId,
      args.templateName,
      args.pickTemplate,
    );
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
