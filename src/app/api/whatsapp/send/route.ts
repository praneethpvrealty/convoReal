import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { parseMetaErrorInfo, type MediaKind } from '@/lib/whatsapp/meta-api';
import { isMediaKind, normalizeCaption } from '@/lib/whatsapp/media-kinds';
import {
  CUSTOMER_WINDOW_EXPIRED_MESSAGE,
  isWithinCustomerWindow,
} from '@/lib/whatsapp/customer-window';
import { parseAgentCommand } from '@/lib/whatsapp/agent-commands';
import { applyAgentCommand } from '@/lib/whatsapp/agent-command-apply';

export async function POST(request: Request) {
  // Resolved outside the main try: that catch maps failures onto Meta
  // send errors, which would turn a 401/403 into "Failed to send".
  // Sending is 'agent' work — the composer already hides itself from
  // viewers via useCan("send-messages"); this enforces the same rule
  // server-side, and blocks archived accounts from burning credits.
  let supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];
  let accountId: string;
  let userId: string;
  try {
    ({ supabase, accountId, userId } = await requireRole('agent'));
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget.
    const limit = await checkRateLimit(`send:${userId}`, RATE_LIMITS.send);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const {
      conversation_id,
      message_type,
      content_text,
      template_name,
      template_language,
      template_params,
      template_message_params,
      reply_to_message_id,
      product_catalog_id,
      product_retailer_id,
      media_url,
      media_kind,
      media_filename,
    } = body;

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      );
    }

    if (message_type === 'text' && !content_text) {
      return NextResponse.json(
        { error: 'content_text is required for text messages' },
        { status: 400 }
      );
    }

    if (message_type === 'template' && !template_name) {
      return NextResponse.json(
        { error: 'template_name is required for template messages' },
        { status: 400 }
      );
    }

    if (message_type === 'product' && !product_retailer_id) {
      return NextResponse.json(
        { error: 'product_retailer_id is required for product messages' },
        { status: 400 }
      );
    }

    // Media arrives already staged by /api/whatsapp/media/upload, so
    // `media_url` is a path in our own bucket rather than caller-supplied
    // input. Refuse anything else: Meta fetches this link server-side,
    // and an arbitrary URL here would make the business number a fetcher
    // for whatever the caller names.
    if (message_type === 'media') {
      if (!media_url || typeof media_url !== 'string') {
        return NextResponse.json(
          { error: 'media_url is required for media messages' },
          { status: 400 }
        );
      }
      if (!media_url.startsWith(`chat-media/${accountId}/`)) {
        return NextResponse.json(
          { error: 'media_url must be an attachment staged by this account' },
          { status: 400 }
        );
      }
      if (!isMediaKind(media_kind)) {
        return NextResponse.json(
          { error: 'media_kind must be one of image, video, audio, document' },
          { status: 400 }
        );
      }
    }

    // Fetch conversation and contact
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*, contact:contacts(*)')
      .eq('id', conversation_id)
      .eq('account_id', accountId)
      .single();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    const contact = conversation.contact;
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      );
    }

    // A staff command, not a message: `SET BUDGET 2CR` writes the
    // contact's budget and stops here, so the lead never sees it. The
    // qualification listener deliberately ignores agent prose (a
    // negotiation counter-offer must not rewrite a buyer's brief);
    // this is the explicit way to file a number heard on a call
    // without leaving the inbox.
    if (message_type === 'text') {
      const command = parseAgentCommand(content_text);
      if (command) {
        const handled = await applyAgentCommand({
          db: supabase,
          accountId,
          userId,
          contactId: contact.id,
          contactName: contact.name ?? null,
          conversationId: conversation.id,
          command,
        });
        return NextResponse.json({ success: true, command: handled });
      }
    }

    // Sanitize and validate phone
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      );
    }

    // Fetch and decrypt WhatsApp config
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single();

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      );
    }

    const accessToken = decrypt(config.access_token);

    // Self-heal legacy CBC-encrypted tokens. Fire-and-forget: we
    // return from the send without waiting, so a failed upgrade just
    // means the next send tries again. The upgrade is idempotent —
    // concurrent sends both produce valid GCM ciphertexts of the same
    // plaintext, last write wins.
    if (isLegacyFormat(config.access_token)) {
      void supabase
        .from('whatsapp_config')
        // Opportunistic re-encryption, declared last-write-wins above;
        // the send does not depend on it.
        // eslint-disable-next-line convoreal/supabase-write-guard
        .update({ access_token: encrypt(accessToken) })
        .eq('id', config.id)
        .then(({ error }) => {
          if (error) {
            console.warn(
              '[whatsapp/send] access_token GCM upgrade failed:',
              error.message
            );
          }
        });
    }

    // Resolve the reply target (if any) to its Meta message_id, which is
    // what `context.message_id` on the outgoing Meta payload needs. The
    // parent must belong to this same conversation — otherwise a caller
    // could quote messages they can't see by guessing UUIDs.
    let contextMessageId: string | undefined;
    let replyToMessageId: string | undefined;
    if (reply_to_message_id) {
      const { data: parent, error: parentError } = await supabase
        .from('messages')
        .select('message_id, conversation_id')
        .eq('id', reply_to_message_id)
        .eq('conversation_id', conversation_id)
        .maybeSingle();

      if (parentError || !parent) {
        return NextResponse.json(
          { error: 'reply_to_message_id not found in this conversation' },
          { status: 400 }
        );
      }
      // The local link is kept either way, so the thread still renders
      // the quote even when WhatsApp itself cannot.
      replyToMessageId = reply_to_message_id;
      if (!parent.message_id) {
        // Parent never reached Meta (still in 'sending' or 'failed') — we
        // can't quote it on WhatsApp. Send without context rather than
        // dropping the message entirely.
        console.warn(
          '[whatsapp/send] reply target has no Meta message_id; sending without context'
        );
      } else {
        contextMessageId = parent.message_id;
      }
    }

    // Send via Meta API — retry with phone-number variants if Meta rejects
    // with "recipient not in allowed list" (common in sandbox / when a
    // number was registered with/without a trunk 0). If an alternate
    // format succeeds, we persist it back to the contact row so the
    // next send goes through on the first attempt.

    // For template sends, load the row so sendTemplateMessage can
    // build header + button components from the template definition.
    // Match on (user_id, name, language) — same triple the unique
    // index enforces — so multi-language templates work correctly.
    // Missing template falls through with `templateRow = null` and
    // the legacy body-only path runs.
    // Load the template row so sendTemplateMessage can build header
    // + button components from the definition. isMessageTemplate
    // guards against a malformed row (e.g. from a partial sync)
    // crashing the send-builder later in the stack.
    let templateRow: MessageTemplate | null = null;
    if (message_type === 'template' && template_name) {
      const { data } = await supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', accountId)
        .eq('name', template_name)
        .eq('language', template_language || 'en_US')
        .maybeSingle();

      let templateData = data;
      if (!templateData) {
        const { data: fallbackTemplates } = await supabase
          .from('message_templates')
          .select('*')
          .eq('account_id', accountId)
          .eq('name', template_name)
          .limit(1);
        if (fallbackTemplates && fallbackTemplates.length > 0) {
          templateData = fallbackTemplates[0];
        }
      }

      if (templateData && !isMessageTemplate(templateData)) {
        return NextResponse.json(
          {
            error:
              'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
          },
          { status: 500 }
        );
      }
      templateRow = (templateData as MessageTemplate) ?? null;
    }

    // ── 24-hour customer service window ─────────────────────────
    // Free-form text is deliverable only within 24 hours of the
    // contact's last inbound message. Meta accepts the send, returns a
    // wamid, and then fails it asynchronously (131047 on the status
    // webhook) — so an unchecked send lands in the thread as a delivery
    // failure minutes later. Refusing it here is the only way to stop
    // that; the caller's isReengagementError() branch matches this
    // message and offers a template instead. Sandbox has no real window
    // and swaps in its own system template rather than refusing.
    let finalMessageType = message_type;
    let finalTemplateName = template_name;
    let finalTemplateRow = templateRow;
    let finalText = content_text;

    // Media is free-form too: outside the 24-hour window Meta accepts it,
    // returns a wamid, then fails it asynchronously — the same trap the
    // text branch exists to avoid. A template is the only way back in,
    // and a template cannot carry an arbitrary attachment, so a blocked
    // media send is refused outright rather than swapped for one.
    if (message_type === 'media') {
      const { data: lastCustomerMsg } = await supabase
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversation.id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (
        !isWithinCustomerWindow(lastCustomerMsg?.created_at ?? null) &&
        config.integration_type !== 'sandbox'
      ) {
        return NextResponse.json(
          {
            error: CUSTOMER_WINDOW_EXPIRED_MESSAGE,
            code: 'CUSTOMER_WINDOW_EXPIRED',
          },
          { status: 409 }
        );
      }
    }

    if (message_type === 'text') {
      const { data: lastCustomerMsg } = await supabase
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversation.id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!isWithinCustomerWindow(lastCustomerMsg?.created_at ?? null)) {
        if (config.integration_type !== 'sandbox') {
          return NextResponse.json(
            {
              error: CUSTOMER_WINDOW_EXPIRED_MESSAGE,
              code: 'CUSTOMER_WINDOW_EXPIRED',
            },
            { status: 409 }
          );
        }

        // Outside 24h window — must use template
        const { data: systemTemplate } = await supabase
          .from('sandbox_system_templates')
          .select('*')
          .eq('name', 'sandbox_general_reply')
          .maybeSingle();

        if (systemTemplate) {
          finalMessageType = 'template';
          finalTemplateName = systemTemplate.name;
          finalTemplateRow = {
            ...systemTemplate,
            account_id: accountId,
            meta_template_id: `sandbox-${systemTemplate.name}`,
            status: 'APPROVED',
            components: [
              {
                type: 'HEADER',
                format: 'TEXT',
                text: systemTemplate.header_text || '',
              },
              {
                type: 'BODY',
                text: systemTemplate.body,
                example: { body_text: [[content_text || 'there']] },
              },
              {
                type: 'FOOTER',
                text: systemTemplate.footer || '',
              },
              {
                type: 'BUTTONS',
                buttons:
                  (
                    systemTemplate.buttons as Array<{
                      type: string;
                      text: string;
                    }>
                  )?.map((b) => ({
                    type: b.type,
                    text: b.text,
                  })) || [],
              },
            ],
            language: systemTemplate.language,
            name: systemTemplate.name,
          };
          finalTemplateRow = finalTemplateRow as unknown as MessageTemplate;
          // Pass the text as template param {{1}}
          finalText = content_text || '';
        }
      }
    }

    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId,
      contactId: contact.id,
      conversationId: conversation.id,
      kind:
        finalMessageType === 'template'
          ? 'template'
          : finalMessageType === 'product'
            ? 'product'
            : finalMessageType === 'media'
              ? 'media'
              : 'text',
      senderType: 'agent',
      text: finalText,
      mediaKind:
        finalMessageType === 'media' ? (media_kind as MediaKind) : undefined,
      mediaLink: finalMessageType === 'media' ? media_url : undefined,
      mediaCaption:
        finalMessageType === 'media'
          ? normalizeCaption(media_kind as MediaKind, content_text)
          : undefined,
      mediaFilename:
        finalMessageType === 'media' && media_kind === 'document'
          ? media_filename || undefined
          : undefined,
      templateName: finalTemplateName,
      templateLanguage: template_language,
      templateParams:
        finalMessageType === 'template'
          ? [finalText || 'there']
          : template_params,
      messageParams: template_message_params ?? undefined,
      templateRow: finalTemplateRow ?? undefined,
      productCatalogId: product_catalog_id || config.catalog_id,
      productRetailerId: product_retailer_id,
      contextMessageId,
      replyToMessageId,
      // An agent typing in the inbox is the one send a dead or archived
      // contact is still allowed to receive — the composer shows them
      // the notice first. Every automated sender leaves this unset.
      allowDeadContact: true,
      customDbClient: supabase,
    });

    if (!result.success) {
      const errorInfo = parseMetaErrorInfo(result.error);
      return NextResponse.json(
        {
          error:
            result.error || 'Failed to send message via WhatsApp dispatcher',
          errorInfo: {
            code: errorInfo.code,
            title: errorInfo.title,
            userMessage: errorInfo.userMessage,
            suggestedActions: errorInfo.suggestedActions,
            isRetryable: errorInfo.isRetryable,
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message_id: result.messageId,
      whatsapp_message_id: result.whatsappMessageId,
    });
  } catch (error) {
    console.error('Error in WhatsApp send POST:', error);
    const errorInfo = parseMetaErrorInfo(error);
    return NextResponse.json(
      {
        error: 'Failed to send message',
        errorInfo: {
          code: errorInfo.code,
          title: errorInfo.title,
          userMessage: errorInfo.userMessage,
          suggestedActions: errorInfo.suggestedActions,
          isRetryable: errorInfo.isRetryable,
        },
      },
      { status: 500 }
    );
  }
}
