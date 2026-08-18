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
import {
  narrowToLanguage,
  resolveSendLanguage,
  isLanguageFallback,
  warnLanguageFallback,
} from "@/lib/whatsapp/template-language";
import type { LanguageCode } from "@/lib/languages";

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

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
  /**
   * The recipient's language. Narrows the candidates to their variant
   * BEFORE `pick` runs, so a caller's own selection policy (photo vs
   * text, Utility over Marketing) still applies — within their
   * language. Omit and this behaves exactly as it always did.
   */
  language?: LanguageCode,
): Promise<MessageTemplate | null> {
  const names = Array.isArray(templateName) ? templateName : [templateName];
  const { data: rows } = await db
    .from("message_templates")
    .select("*")
    .eq("account_id", accountId)
    .in("name", names)
    .order("last_submitted_at", { ascending: false });
  const all = (rows || []) as MessageTemplate[];
  const templates = language ? narrowToLanguage(all, language) : all;
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
    /** Params derived from whichever template `pickTemplate` lands on.
     *  A renamed template can carry a different param count from the
     *  predecessor it falls back to, and Meta rejects a mismatch — so
     *  the caller that knows both builds them after the choice, not
     *  before. Wins over templateParams when both are given. */
    buildParams?: (template: MessageTemplate) => string[];
    /** Send-time values for URL buttons with a `{{1}}` suffix, keyed by
     *  the button's index — same reason buildParams exists over a
     *  fixed array: the button's index depends on which template
     *  `pickTemplate` lands on. */
    buildButtonParams?: (template: MessageTemplate) => Record<number, string> | undefined;
    /** Media-header image, resolved to a URL Meta can fetch. Ignored by
     *  a template with a text header, so callers can pass it blind. */
    headerMediaUrl?: string | null;
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

    if (!args.templateName || !(args.templateParams || args.buildParams)) {
      return false;
    }
    // Den notifications go to a property OWNER, who is a contact like
    // any other — their preferred_language decides the variant.
    const language = await resolveSendLanguage(
      db,
      args.accountId,
      args.contactId ?? null,
    );
    const template = await approvedTemplate(
      db,
      args.accountId,
      args.templateName,
      args.pickTemplate,
      language,
    );
    if (!template) return false;
    if (isLanguageFallback(template, language)) {
      warnLanguageFallback("den-notify", args.accountId, language, template);
    }
    const params = args.buildParams
      ? args.buildParams(template)
      : args.templateParams!;
    const buttonParams = args.buildButtonParams?.(template);

    const res = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      contactId: args.contactId,
      kind: "template",
      senderType: "bot",
      templateName: template.name,
      templateLanguage: template.language || "en_US",
      templateParams: params,
      messageParams: {
        body: params,
        ...(buttonParams && Object.keys(buttonParams).length > 0 ? { buttonParams } : {}),
        ...(args.headerMediaUrl ? { headerMediaUrl: args.headerMediaUrl } : {}),
      },
      templateRow: template,
      text: args.text,
    });
    return res.success;
  } catch (err) {
    console.error("[den-notify] send failed (non-fatal):", err);
    return false;
  }
}
