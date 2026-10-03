import { sendTextMessage } from '@/lib/whatsapp/meta-api';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { BRANDING } from '@/config/branding';
import { suggestNameTagSplit } from '@/lib/contacts/name-tag-split';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logText } from '@/lib/whatsapp/inbound/log-text';
import type { InboundChainContext, StepResult } from '../context';

export async function sharedContacts(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    accessToken,
    message,
    configOwnerUserId,
    phoneNumberId,
    senderPhone,
    conversation,
  } = ctx;
  if (
    message.type === 'contacts' &&
    message.contacts &&
    message.contacts.length > 0
  ) {
    console.log(
      `[webhook] Shared contacts message detected from: ${logText(senderPhone)}`
    );

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const importedNames: string[] = [];

    for (const c of message.contacts) {
      let name = c.name?.formatted_name || '';
      let phone = '';
      let email = '';

      if (c.vcard) {
        const fnMatch = c.vcard.match(/FN:(.+)/i);
        if (fnMatch) name = fnMatch[1].trim();

        const telMatch = c.vcard.match(/TEL(?:;[^:]*)?:(.+)/i);
        if (telMatch) phone = telMatch[1].trim();

        const emailMatch = c.vcard.match(/EMAIL(?:;[^:]*)?:(.+)/i);
        if (emailMatch) email = emailMatch[1].trim();
      }

      if (!phone && c.phones && c.phones.length > 0) {
        phone = c.phones[0].phone;
      }
      if (!email && c.emails && c.emails.length > 0) {
        email = c.emails[0].email;
      }

      if (!phone) continue;

      const normalizedImportPhone = normalizePhoneWithCountryCode(phone);
      if (!normalizedImportPhone) continue;

      const cleanPhone = normalizedImportPhone.replace(/\D/g, '');
      const { data: existingContact } = await supabaseAdmin()
        .from('contacts')
        .select('id, name')
        .eq('account_id', accountId)
        .or(`phone.eq.${normalizedImportPhone},phone.eq.${cleanPhone}`)
        .maybeSingle();

      if (!existingContact) {
        // Forwarded phonebook cards carry the agent's quick-reference names
        // ("Nataraj Bank DSA") — split the qualifier into the Engine-only Name
        // Tag so outbound messages use the clean name.
        const nameSplit = name ? suggestNameTagSplit(name) : null;
        const { error: insertErr } = await supabaseAdmin()
          .from('contacts')
          .insert({
            account_id: accountId,
            user_id: configOwnerUserId || null,
            name:
              nameSplit?.name ?? (name || `Contact ${normalizedImportPhone}`),
            name_tag: nameSplit?.nameTag ?? null,
            phone: normalizedImportPhone,
            email: email || null,
            classification: 'Others',
            company: '',
            status: 'pending_review',
            source: 'WhatsApp',
          });

        if (insertErr) {
          console.error(
            '[webhook] Failed to auto-insert shared contact:',
            insertErr
          );
        } else if (nameSplit) {
          importedNames.push(`${nameSplit.name} — 🏷️ ${nameSplit.nameTag}`);
        } else {
          importedNames.push(name || normalizedImportPhone);
        }
      } else {
        importedNames.push(
          `${existingContact.name} (already in ${BRANDING.name})`
        );
      }
    }

    if (importedNames.length > 0) {
      let replyText = `📥 *Contact Import Status:*\n\n`;
      importedNames.forEach((n, idx) => {
        replyText += `✅ ${idx + 1}. *${n}*\n`;
      });

      replyText += `\nClick here to complete classification and details:\n${baseUrl}/contacts`;

      try {
        const sendRes = await sendTextMessage({
          phoneNumberId,
          accessToken,
          to: senderPhone,
          text: replyText,
        });

        const { data: botMsg } = await supabaseAdmin()
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            sender_type: 'bot',
            content_type: 'text',
            content_text: replyText,
            message_id: sendRes.messageId,
            status: 'sent',
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (botMsg) {
          await supabaseAdmin()
            .from('conversations')
            .update({
              last_message_text: replyText,
              last_message_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              awaiting_reply: false,
            })
            .eq('id', conversation.id);
        }
      } catch (err) {
        console.error(
          '[webhook] Failed to send contact import confirmation auto-reply:',
          err
        );
      }
    }
  }
  return 'continue';
}
