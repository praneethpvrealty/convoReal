import { SupabaseClient } from '@supabase/supabase-js';
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { EmailSyncConfig, MessageTemplate } from '@/types';

export interface SendAutoReplyResult {
  success: boolean;
  messageId?: string;
  error?: string;
  usedTemplateName?: string | null;
  replyText?: string;
}

// Helper to dynamically build body params matching the placeholders in body_text
export function buildBodyParams(bodyText: string | null | undefined, leadName: string, leadSource: string): string[] {
  if (!bodyText) return [];
  const matches = bodyText.match(/\{\{\d+\}\}/g) || [];
  const uniqueVars = new Set(matches);
  const count = uniqueVars.size;

  const params: string[] = [];
  if (count >= 1) {
    params.push(leadName || 'there');
  }
  if (count >= 2) {
    params.push(leadSource || 'portal');
  }
  // Pad with empty strings for any extra placeholders (e.g. {{3}}, {{4}})
  for (let i = 2; i < count; i++) {
    params.push('');
  }
  return params;
}

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
}): Promise<SendAutoReplyResult> {
  const logPrefix = `[lead-webhook][sendAutoReply][${cleanPhone}]`;

  // When forceSend is true (email-webhook lead collection), we always attempt
  // to deliver a message regardless of the auto_reply_enabled setting.
  if (!forceSend && !syncConfig?.auto_reply_enabled) {
    console.log(`${logPrefix} Skipped: auto_reply not enabled and forceSend=false`);
    return { success: false, error: 'auto_reply not enabled' };
  }

  const { data: waConfig } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .eq('status', 'connected')
    .maybeSingle();

  if (!waConfig) {
    console.warn(`${logPrefix} FAILED: no connected WhatsApp config for account ${accountId}`);
    return { success: false, error: 'No connected WhatsApp config for this account' };
  }

  console.log(`${logPrefix} WhatsApp config loaded. phone_number_id=${waConfig.phone_number_id}`);

  try {
    let replyText = '';
    let messageId = '';
    let usedTemplateName: string | null = null;

    // ── Primary template (from syncConfig) ──
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
      if (template) {
        console.log(`${logPrefix} Primary template resolved: ${template.name} (lang: ${template.language || 'en_US'})`);
      } else {
        console.log(`${logPrefix} Primary template "${syncConfig.auto_reply_template_name}" not found or not APPROVED`);
      }
    } else {
      console.log(`${logPrefix} No primary template configured in syncConfig`);
    }

    if (template) {
      const bodyParams = buildBodyParams(template.body_text, leadName, leadSource);

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
        replyText = template.body_text
          .replace(/\{\{1\}\}/g, leadName || 'there')
          .replace(/\{\{2\}\}/g, leadSource || 'portal');

        console.log(`${logPrefix} Primary template SENT: ${template.name}, Meta messageId=${messageId}`);
      } catch (tplErr) {
        const errMsg = (tplErr as Error).message || '';
        console.error(`${logPrefix} Primary template ${template.name} FAILED: ${errMsg}`);
        if (errMsg.includes('132001') || errMsg.toLowerCase().includes('does not exist')) {
          console.warn(`${logPrefix} Marking template ${template.name} as INACTIVE in DB`);
          await supabase
            .from('message_templates')
            .update({ status: 'INACTIVE' })
            .eq('id', template.id);
        } else {
          return { success: false, error: `Primary template failed: ${errMsg}` };
        }
      }
    }

    // ── Fallback path ──
    if (!messageId) {
      // Check 24-hour customer service window before sending free-form text.
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
          console.log(`${logPrefix} Last customer msg: ${lastCustomerMsg.created_at}, within24h=${isWithin24Hours}`);
        } else {
          console.log(`${logPrefix} No prior customer messages in conversation`);
        }
      } else {
        console.log(`${logPrefix} No conversationId provided — cannot check 24h window`);
      }

      // Within 24h window: send free-form text if available
      if (isWithin24Hours && syncConfig?.auto_reply_text) {
        replyText = syncConfig.auto_reply_text
          .replace(/{name}/g, leadName || 'there')
          .replace(/{source}/g, leadSource || 'portal');

        console.log(`${logPrefix} Sending free-form text (within 24h window): "${replyText.slice(0, 60)}..."`);
        const sendRes = await sendTextMessage({
          phoneNumberId: waConfig.phone_number_id,
          accessToken: decrypt(waConfig.access_token),
          to: cleanPhone,
          text: replyText,
        });
        messageId = sendRes.messageId;
        console.log(`${logPrefix} Free-form text SENT, Meta messageId=${messageId}`);
      } else {
        // Outside 24h window (or no free-form text configured) — MUST use a template.
        // Try ALL approved templates (no category restriction) so we maximise chances.
        console.log(`${logPrefix} Outside 24h window. Querying ALL approved templates for account ${accountId}...`);
        const { data: fallbackTemplates, error: tplErr } = await supabase
          .from('message_templates')
          .select('*')
          .eq('account_id', accountId)
          .eq('status', 'APPROVED')
          .order('created_at', { ascending: true });

        if (tplErr) {
          console.error(`${logPrefix} DB error querying templates:`, tplErr);
          return { success: false, error: `Template DB query failed: ${tplErr.message}` };
        }

        console.log(`${logPrefix} Found ${fallbackTemplates?.length || 0} approved template(s)`);

        let sent = false;
        for (const fallbackTemplate of fallbackTemplates || []) {
          if (sent) break;

          const dbLang = (fallbackTemplate as MessageTemplate).language || 'en_US';
          const tryLanguages = [dbLang, ...['en_US', 'en', 'en_GB'].filter(l => l !== dbLang)];

          for (const lang of tryLanguages) {
            try {
              console.log(`${logPrefix} Trying fallback template: ${fallbackTemplate.name} (lang: ${lang})`);

              const tpl = fallbackTemplate as MessageTemplate;
              const bodyParams = buildBodyParams(tpl.body_text, leadName, leadSource);
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
                .replace(/\{\{1\}\}/g, leadName || 'there')
                .replace(/\{\{2\}\}/g, leadSource || 'portal');
              sent = true;
              console.log(`${logPrefix} Fallback template SENT: ${tpl.name} (lang: ${lang}), Meta messageId=${messageId}`);
              break;
            } catch (langErr) {
              const errMsg = (langErr as Error).message || '';
              console.warn(`${logPrefix} Template ${fallbackTemplate.name} failed with lang ${lang}: ${errMsg}`);

              if (errMsg.includes('132001') || errMsg.toLowerCase().includes('does not exist')) {
                console.warn(`${logPrefix} Marking template ${fallbackTemplate.name} as INACTIVE`);
                await supabase
                  .from('message_templates')
                  .update({ status: 'INACTIVE' })
                  .eq('id', fallbackTemplate.id);
                break;
              }
              // Continue to next language for other errors
            }
          }
        }

        if (!sent) {
          const err = `No approved template could be sent to ${cleanPhone}. Account has ${fallbackTemplates?.length || 0} approved template(s). Create a template in Meta Business Manager and sync.`;
          console.error(`${logPrefix} ${err}`);
          return { success: false, error: err };
        }
      }
    }

    // ── Persist sent message to DB ──
    if (conversationId && replyText && messageId) {
      console.log(`${logPrefix} Persisting message to DB. conversationId=${conversationId}, type=${usedTemplateName ? 'template' : 'text'}`);
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
      console.log(`${logPrefix} Message persisted successfully`);
    } else {
      console.warn(`${logPrefix} Cannot persist: missing conversationId=${conversationId}, replyText=${!!replyText}, messageId=${!!messageId}`);
    }

    return { success: true, messageId, usedTemplateName, replyText };
  } catch (sendErr) {
    const errMsg = (sendErr as Error).message || 'Unknown error';
    console.error(`${logPrefix} Unhandled exception:`, sendErr);
    return { success: false, error: errMsg };
  }
}
