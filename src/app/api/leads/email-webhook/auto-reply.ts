import { SupabaseClient } from '@supabase/supabase-js';
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { EmailSyncConfig, MessageTemplate } from '@/types';

// Helper to trigger automatic WhatsApp auto-reply (either approved template or custom text)
export async function sendAutoReply({
  supabase,
  accountId,
  syncConfig,
  conversationId,
  cleanPhone,
  leadName,
  leadSource,
  forceSend = false,
}: {
  supabase: SupabaseClient;
  accountId: string;
  syncConfig: EmailSyncConfig | null;
  conversationId: string | null;
  cleanPhone: string;
  leadName: string;
  leadSource: string;
  forceSend?: boolean;
}) {
  // When forceSend is true (email-webhook lead collection), we always attempt
  // to deliver a message regardless of the auto_reply_enabled setting.
  if (!forceSend && !syncConfig?.auto_reply_enabled) return;

  const { data: waConfig } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .eq('status', 'connected')
    .maybeSingle();

  if (!waConfig) {
    console.warn(`[lead-webhook] Cannot send auto-reply: no connected WhatsApp config for account ${accountId}`);
    return;
  }

  try {
    let replyText = '';
    let messageId = '';
    let usedTemplateName: string | null = null;

    let template: MessageTemplate | null = null;
    if (syncConfig?.auto_reply_template_name) {
      const { data: foundTemplate } = await supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', accountId)
        .eq('name', syncConfig.auto_reply_template_name)
        .eq('status', 'APPROVED')
        .maybeSingle();
      template = foundTemplate as unknown as MessageTemplate;
    }

    let primaryTemplateFailed = false;
    if (template) {
      const bodyParams = [
        leadName || 'there',
        leadSource || 'portal'
      ];
      
      // Auto-resolve dynamic URL buttons if the template has them
      const buttonParams: Record<number, string> = {};
      if (template.buttons && Array.isArray(template.buttons)) {
        template.buttons.forEach((btn, idx: number) => {
          if (btn.type === 'URL' && btn.url && btn.url.includes('{{1}}')) {
            buttonParams[idx] = `?ref=${accountId}`;
          }
        });
      }
      
      try {
        const sendRes = await sendTemplateMessage({
          phoneNumberId: waConfig.phone_number_id,
          accessToken: decrypt(waConfig.access_token),
          to: cleanPhone,
          templateName: template.name,
          language: template.language || 'en_US',
          template: template || undefined,
          messageParams: {
            body: bodyParams,
            ...(Object.keys(buttonParams).length > 0 ? { buttonParams } : {})
          }
        });
        
        messageId = sendRes.messageId;
        usedTemplateName = template.name;
        
        // Format text for storing in messages log
        replyText = template.body_text
          .replace(/{{1}}/g, leadName || 'there')
          .replace(/{{2}}/g, leadSource || 'portal');
      } catch (tplErr) {
        const errMsg = (tplErr as Error).message || '';
        // If template not found on Meta (132001), mark inactive and fall through
        if (errMsg.includes('132001') || errMsg.toLowerCase().includes('does not exist')) {
          console.warn(`[lead-webhook] Configured template ${template.name} does not exist on Meta. Marking inactive and trying fallbacks.`);
          await supabase
            .from('message_templates')
            .update({ status: 'INACTIVE' })
            .eq('id', template.id);
          primaryTemplateFailed = true;
        } else {
          throw tplErr; // Re-throw other errors
        }
      }
    }

    // If primary template wasn't configured or failed, try fallback templates
    if (!messageId && (primaryTemplateFailed || !template)) {
      // Check 24-hour customer service window before sending free-form text.
      // Meta rejects free-form messages outside the window (Error 131047).
      let isWithin24Hours = false;
      if (conversationId) {
        const { data: lastCustomerMsg } = await supabase
          .from('messages')
          .select('created_at')
          .eq('conversation_id', conversationId)
          .eq('sender_type', 'customer')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastCustomerMsg) {
          const lastMsgTime = new Date(lastCustomerMsg.created_at).getTime();
          isWithin24Hours = (Date.now() - lastMsgTime) < 24 * 60 * 60 * 1000;
        }
      }

      if (isWithin24Hours && syncConfig?.auto_reply_text) {
        // Within 24h window — send free-form text
        replyText = syncConfig.auto_reply_text
          .replace(/{name}/g, leadName || 'there')
          .replace(/{source}/g, leadSource || 'portal');

        const sendRes = await sendTextMessage({
          phoneNumberId: waConfig.phone_number_id,
          accessToken: decrypt(waConfig.access_token),
          to: cleanPhone,
          text: replyText,
        });
        messageId = sendRes.messageId;
      } else {
        // 24h window expired — fall back to an approved Utility template.
        // Templates work outside the 24h window; free-form text does not.
        const { data: fallbackTemplates } = await supabase
          .from('message_templates')
          .select('*')
          .eq('account_id', accountId)
          .eq('status', 'APPROVED')
          .in('category', ['UTILITY', 'UTILITY_MARKETING', 'MARKETING'])
          .order('created_at', { ascending: true });

        // Try templates in order, attempting the DB language first then
        // common English fallbacks. This handles cases where the DB
        // language code doesn't match Meta's registered locale.
        // If a template fails with 132001 (not found), mark it inactive
        // in the DB so future requests skip it.
        let sent = false;
        for (const fallbackTemplate of fallbackTemplates || []) {
          if (sent) break;

          const dbLang = (fallbackTemplate as MessageTemplate).language || 'en_US';
          const tryLanguages = [dbLang, ...['en_US', 'en', 'en_GB'].filter(l => l !== dbLang)];

          for (const lang of tryLanguages) {
            try {
              console.log(`[lead-webhook] 24h session expired for ${cleanPhone}. Trying template: ${fallbackTemplate.name} (lang: ${lang})`);

              const bodyParams = [leadName || 'there', leadSource || 'portal'];
              const tpl = fallbackTemplate as MessageTemplate;
              const buttonParams: Record<number, string> = {};
              if (tpl.buttons && Array.isArray(tpl.buttons)) {
                tpl.buttons.forEach((btn, idx: number) => {
                  if (btn.type === 'URL' && btn.url && btn.url.includes('{{1}}')) {
                    buttonParams[idx] = `?ref=${accountId}`;
                  }
                });
              }

              const sendRes = await sendTemplateMessage({
                phoneNumberId: waConfig.phone_number_id,
                accessToken: decrypt(waConfig.access_token),
                to: cleanPhone,
                templateName: tpl.name,
                language: lang,
                template: tpl,
                messageParams: {
                  body: bodyParams,
                  ...(Object.keys(buttonParams).length > 0 ? { buttonParams } : {})
                }
              });

              messageId = sendRes.messageId;
              usedTemplateName = tpl.name;
              replyText = (tpl.body_text || '')
                .replace(/{{1}}/g, leadName || 'there')
                .replace(/{{2}}/g, leadSource || 'portal');
              sent = true;
              break;
            } catch (langErr) {
              const errMsg = (langErr as Error).message || '';
              console.warn(`[lead-webhook] Template ${fallbackTemplate.name} failed with lang ${lang}:`, errMsg);

              // If 132001 (template not found on Meta), mark inactive in DB
              if (errMsg.includes('132001') || errMsg.toLowerCase().includes('does not exist')) {
                console.warn(`[lead-webhook] Template ${fallbackTemplate.name} does not exist on Meta. Marking as inactive.`);
                await supabase
                  .from('message_templates')
                  .update({ status: 'INACTIVE' })
                  .eq('id', fallbackTemplate.id);
                break; // Skip to next template, don't try other languages
              }
              // Continue to next language for other errors
            }
          }
        }

        if (!sent) {
          console.warn(`[lead-webhook] 24h session expired for ${cleanPhone} and no fallback template worked. Create a Utility template on Meta Business Manager and sync from Settings > WhatsApp > Templates.`);
        }
      }
    } else {
      return; // No reply configured
    }

    if (conversationId && replyText && messageId) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_type: 'bot',
        content_type: usedTemplateName ? 'template' : 'text',
        content_text: replyText,
        template_name: usedTemplateName,
        message_id: messageId,
        status: 'sent',
        created_at: new Date().toISOString(),
      });
    }
  } catch (sendErr) {
    console.error('[lead-webhook] Failed to send auto-reply:', sendErr);
  }
}
