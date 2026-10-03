import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';

// ------------------------------------------------------------
// Automation-side Meta sender.
//
// Refactored to leverage the unified dispatcher helper.
// ------------------------------------------------------------

interface SendTextArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so an automation authored by user A still sends through
   *  the WhatsApp number user B saved on the same account. */
  accountId: string;
  /** Original author of the automation/flow — used for INSERT audit
   *  columns (messages.sender_id-ish) and for resolving the agent's
   *  identity in logs. Not consulted for tenancy. */
  userId: string;
  conversationId: string;
  contactId: string;
  text: string;
}

interface SendTemplateArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  templateName: string;
  language?: string;
  params?: string[];
}

export async function engineSendText(
  args: SendTextArgs
): Promise<{ whatsapp_message_id: string }> {
  const result = await sendWhatsAppMessageAndPersist({
    accountId: args.accountId,
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    kind: 'text',
    senderType: 'bot',
    text: args.text,
    customDbClient: supabaseAdmin(),
  });

  if (!result.success || !result.whatsappMessageId) {
    throw new Error(
      result.error || 'Failed to send text via WhatsApp dispatcher'
    );
  }

  return { whatsapp_message_id: result.whatsappMessageId };
}

export async function engineSendTemplate(
  args: SendTemplateArgs
): Promise<{ whatsapp_message_id: string }> {
  const result = await sendWhatsAppMessageAndPersist({
    accountId: args.accountId,
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    kind: 'template',
    senderType: 'bot',
    templateName: args.templateName,
    templateLanguage: args.language,
    templateParams: args.params,
    customDbClient: supabaseAdmin(),
  });

  if (!result.success || !result.whatsappMessageId) {
    throw new Error(
      result.error || 'Failed to send template via WhatsApp dispatcher'
    );
  }

  return { whatsapp_message_id: result.whatsappMessageId };
}
