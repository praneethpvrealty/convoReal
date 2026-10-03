import { decrypt } from '@/lib/whatsapp/encryption';
import {
  resolveConversation,
  type ConversationRow,
} from '@/lib/conversations/resolve';
import {
  loadRetiredNumberProfile,
  replyFromRetiredNumber,
} from '@/lib/whatsapp/retired-number-reply';
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils';
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook';
import {
  isGroupWebhookField,
  processGroupWebhook,
} from '@/lib/whatsapp/group-webhooks';
import {
  groupIdFromInbound,
  resolveGroupSender,
  resolveGroupThread,
} from '@/lib/whatsapp/group-inbound';
import { checkIsAccountOwner } from '@/lib/ai/chatbot-engine';
import { processBuyerQualificationMessage } from '@/lib/ai/buyer-qualification';
// The per-template CLOSE_BUTTON constants are gone from here on
// purpose: matchTemplateButton resolves a tap to its action in any
// language we send, and comparing against one English string again
// would silently stop working for every translated template.
import { enquiryStatusUpdate } from '@/lib/contacts/enquiry-review';
import {
  processCtwaReferral,
  type WhatsAppReferral,
} from '@/lib/whatsapp/ctwa-attribution';
import { resolveRouting } from '@/lib/whatsapp/routing-engine';
import { SHARED_CARDS_HEADER } from '@/lib/contacts/shared-cards';
import { googleMapsUrlForCoordinates } from '@/lib/maps/resolve-location';
import { getSandboxSystemConfig } from '@/lib/system-settings';
import {
  isSandboxTrialExpired,
  releaseSandboxSender,
  type SandboxTenantConfig,
} from '@/lib/whatsapp/sandbox-trial';
import type { SandboxSenderMapping } from '@/types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runSerializedInbound } from '@/lib/whatsapp/serialized-inbound';
import {
  buildCatalogOrderMessage,
  isDirectPropertyInterest,
  resolvePropertyReference,
  isDeliberateEnquiry,
  type PropertyInterestCandidate,
  type WhatsAppCatalogOrder,
} from '@/lib/whatsapp/property-interest';
import { handleStatusUpdate } from '@/lib/whatsapp/inbound/status-updates';
import {
  handleReaction,
  lookupInternalIdByMetaId,
} from '@/lib/whatsapp/inbound/reactions';
import { handleInboundChain } from '@/lib/whatsapp/inbound/chain/run';
import type { InboundChainPayload } from '@/lib/whatsapp/inbound/chain/context';

export interface WhatsAppMessage {
  id: string;
  /** The PARTICIPANT's phone on a group message, not the group. */
  from: string;
  /** Present only on group messages. Its absence is what marks an
   *  inbound as an ordinary one-to-one. */
  group_id?: string | null;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  document?: {
    id: string;
    mime_type: string;
    filename?: string;
    caption?: string;
  };
  audio?: { id: string; mime_type: string };
  sticker?: { id: string; mime_type: string };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  reaction?: { message_id: string; emoji: string };
  button?: { text: string; payload: string };
  contacts?: Array<{
    name: { formatted_name: string; first_name?: string; last_name?: string };
    phones?: Array<{ phone: string; type?: string; wa_id?: string }>;
    emails?: Array<{ email: string; type?: string }>;
    vcard: string;
  }>;
  /** A property selected from the WhatsApp Commerce catalog. Meta calls
   *  this an order even when the customer is only sharing one listing. */
  order?: WhatsAppCatalogOrder & { catalog_id?: string };
  interactive?: {
    type: 'button_reply' | 'list_reply' | 'nfm_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
    /** Completed native Meta Flow (form-screen) submission. */
    nfm_reply?: { name?: string; body?: string; response_json: string };
  };
  context?: { id: string };
  // Present only on the FIRST inbound message of a thread the buyer
  // started from a Click-to-WhatsApp ad (Instagram/Facebook). See
  // ctwa-attribution.ts.
  referral?: WhatsAppReferral;
}

export interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      contacts?: Array<{
        profile?: { name?: string };
        wa_id: string;
      }>;
      messages?: WhatsAppMessage[];
      statuses?: Array<{
        id: string;
        status: string;
        timestamp: string;
        recipient_id: string;
        errors?: Array<{
          code: number;
          title: string;
          message: string;
          error_data?: {
            details?: string;
          };
        }>;
      }>;
    };
    field: string;
  }>;
}

// ── Sandbox Routing ───────────────────────────────────────────────

const HASHTAG_REGEX = /^#([a-zA-Z0-9]+)\s*/;

interface SandboxRouteResult {
  accountId: string;
  userId: string;
  sandboxCode: string;
  isNewMapping: boolean;
}

async function resolveSandboxAccount(
  message: WhatsAppMessage,
  senderPhone: string
): Promise<SandboxRouteResult | null> {
  const textBody = message.text?.body?.trim() || '';
  const hashtagMatch = textBody.match(HASHTAG_REGEX);

  // 1. Try hashtag prefix match
  if (hashtagMatch) {
    const code = hashtagMatch[1].toLowerCase();
    const { data: configRows } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id, user_id, sandbox_code')
      .eq('integration_type', 'sandbox')
      .ilike('sandbox_code', code)
      .limit(1);

    if (configRows && configRows.length > 0) {
      const cfg = configRows[0];
      // Create or update mapping
      await supabaseAdmin()
        .from('sandbox_sender_mappings')
        .upsert(
          {
            sender_phone: senderPhone,
            account_id: cfg.account_id,
            sandbox_code: cfg.sandbox_code,
            updated_at: new Date().toISOString(),
            last_message_at: new Date().toISOString(),
          } as unknown as never[],
          { onConflict: 'sender_phone' }
        );

      return {
        accountId: cfg.account_id,
        userId: cfg.user_id,
        sandboxCode: cfg.sandbox_code,
        isNewMapping: true,
      };
    }
  }

  // 2. Fallback: query existing sender mapping
  const { data: mapping } = await supabaseAdmin()
    .from('sandbox_sender_mappings')
    .select('*')
    .eq('sender_phone', senderPhone)
    .maybeSingle();

  if (mapping) {
    // Update last_message_at
    await supabaseAdmin()
      .from('sandbox_sender_mappings')
      .update({ last_message_at: new Date().toISOString() })
      .eq('sender_phone', senderPhone);

    return {
      accountId: (mapping as unknown as SandboxSenderMapping).account_id,
      userId: '', // Will be resolved below
      sandboxCode: (mapping as unknown as SandboxSenderMapping).sandbox_code,
      isNewMapping: false,
    };
  }

  return null;
}

async function resolveSandboxOwnerUserId(accountId: string): Promise<string> {
  const { data: profile } = await supabaseAdmin()
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return (profile?.user_id as string) || '';
}

/**
 * The sandbox route for this sender, and the tenant config the caller
 * still needs for the message-limit check — or null when there is no
 * LIVE route.
 *
 * "Live" is the whole point: a mapping to a tenant whose trial has
 * lapsed used to resolve, and the message was then dropped with a bare
 * `continue`. Both callers already treat a null route as "not a sandbox
 * message", and that path answers — at the first call site by falling
 * through to whichever Official API account owns the number. So an
 * expired trial now releases its dead mapping and reports no route,
 * which puts the sender back on a path that replies instead of
 * blackholing them forever. See sandbox-trial.ts.
 */
async function resolveLiveSandboxRoute(
  message: WhatsAppMessage,
  senderPhone: string
): Promise<{
  route: SandboxRouteResult;
  tenantConfig: SandboxTenantConfig | null;
} | null> {
  const route = await resolveSandboxAccount(message, senderPhone);
  if (!route) return null;

  const { data } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('trial_ends_at, sandbox_message_count, sandbox_message_limit')
    .eq('account_id', route.accountId)
    .maybeSingle();
  const tenantConfig = (data as SandboxTenantConfig | null) ?? null;

  if (!isSandboxTrialExpired(tenantConfig)) return { route, tenantConfig };

  console.warn(
    `[webhook] Sandbox trial expired for account ${route.accountId} — releasing mapping for ${senderPhone} so this message can fall through instead of being dropped.`
  );
  await releaseSandboxSender(supabaseAdmin(), senderPhone);
  return null;
}

export async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return;

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      if (isTemplateWebhookField(change.field)) {
        await handleTemplateWebhookChange(
          { field: change.field, value: change.value as unknown },
          supabaseAdmin()
        );
        continue;
      }

      // Group lifecycle/participants/settings/status. These carry no
      // `messages` or `contacts`, so they have to be dispatched before
      // the inbound-message path below drops them.
      if (isGroupWebhookField(change.field)) {
        const groupPhoneNumberId = (
          change.value as { metadata?: { phone_number_id?: string } }
        )?.metadata?.phone_number_id;
        if (groupPhoneNumberId) {
          const { data: groupConfigs } = await supabaseAdmin()
            .from('whatsapp_config')
            .select('account_id')
            .eq('phone_number_id', groupPhoneNumberId);

          // Same rule as the message path: an ambiguous number is
          // dropped rather than written to an arbitrary account.
          if (groupConfigs?.length === 1) {
            await processGroupWebhook(
              groupConfigs[0].account_id as string,
              change.field,
              change.value as unknown
            );
          } else {
            console.error(
              `[webhook] group event for phone_number_id ${groupPhoneNumberId} matched ${groupConfigs?.length ?? 0} configs. Dropping.`
            );
          }
        }
        continue;
      }

      const value = change.value;

      // Handle status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status);
        }
      }

      // Handle incoming messages
      if (!value.messages || !value.contacts) continue;

      const phoneNumberId = value.metadata.phone_number_id;
      console.log(
        `[webhook] Incoming messages for phone_number_id: ${phoneNumberId}, messages: ${value.messages.length}`
      );

      const sandboxSystem = await getSandboxSystemConfig();
      const isSystemSandboxNumber =
        sandboxSystem.enabled &&
        sandboxSystem.phone_number_id === phoneNumberId;

      // ── 1. If this is the shared sandbox number, try tenant routing per-message ──
      if (isSystemSandboxNumber) {
        console.log(
          `[webhook] phone_number_id ${phoneNumberId} matches system sandbox config. Trying hashtag/sender routing per message...`
        );

        for (let i = 0; i < value.messages.length; i++) {
          const message = value.messages[i];
          const contact = value.contacts[i] || value.contacts[0];
          const senderPhone = normalizePhone(message.from);

          console.log(
            `[webhook] Attempting sandbox routing for sender: ${senderPhone}, body: "${message.text?.body?.substring(0, 50) || '[non-text]'}"`
          );

          // Null here means "no live sandbox tenant owns this sender" —
          // never mapped, or mapped to a lapsed trial, which releases
          // itself. Either way the Official API fallback below answers.
          const live = await resolveLiveSandboxRoute(message, senderPhone);
          if (live) {
            const { route, tenantConfig } = live;
            console.log(
              `[webhook] Resolved sandbox route: account=${route.accountId}, code=${route.sandboxCode}, newMapping=${route.isNewMapping}`
            );

            // Resolve owner user_id if not cached in mapping
            const ownerUserId =
              route.userId ||
              (await resolveSandboxOwnerUserId(route.accountId));

            // Rate limit check & atomic increment
            const msgLimit = tenantConfig?.sandbox_message_limit ?? 50;
            const { data: allowed, error: rpcErr } = await supabaseAdmin().rpc(
              'increment_sandbox_message_count',
              {
                p_account_id: route.accountId,
                p_limit: msgLimit,
              }
            );

            if (rpcErr || !allowed) {
              console.warn(
                `[webhook] Sandbox message limit reached or error for account ${route.accountId} (limit: ${msgLimit}). Dropping.`
              );
              continue;
            }

            // Strip the sandbox hashtag from the message text before storing
            // so the UI shows "hi" instead of "#convo870 hi"
            const cleanedMessage = { ...message };
            if (cleanedMessage.text?.body) {
              cleanedMessage.text = {
                ...cleanedMessage.text,
                body: cleanedMessage.text.body
                  .replace(HASHTAG_REGEX, '')
                  .trim(),
              };
            }

            // Use system sandbox credentials if available
            let decryptedSystemToken = '';
            if (sandboxSystem.access_token) {
              try {
                decryptedSystemToken = decrypt(sandboxSystem.access_token);
              } catch (err) {
                console.warn(
                  '[webhook] Failed to decrypt sandbox system token:',
                  err
                );
              }
            }

            await processMessage(
              cleanedMessage,
              contact,
              route.accountId,
              ownerUserId,
              decryptedSystemToken,
              phoneNumberId
            );
            continue;
          }

          // No LIVE sandbox route for this message — fall back to Official API config (if same number is also an official number)
          console.warn(
            `[webhook] No live sandbox route for sender ${senderPhone}. Checking Official API fallback...`
          );

          const { data: fallbackConfigs } = await supabaseAdmin()
            .from('whatsapp_config')
            .select('*')
            .eq('phone_number_id', phoneNumberId);

          if (fallbackConfigs && fallbackConfigs.length === 1) {
            const fb = fallbackConfigs[0];
            console.log(
              `[webhook] Falling back to Official API account: ${fb.account_id}`
            );
            let fbToken: string;
            try {
              fbToken = decrypt(fb.access_token);
            } catch (err) {
              console.error(
                '[webhook] Failed to decrypt fallback access_token:',
                err
              );
              continue;
            }
            await processMessage(
              message,
              contact,
              fb.account_id,
              fb.user_id,
              fbToken,
              fb.phone_number_id
            );
            continue;
          }

          console.warn(
            `[webhook] No sandbox route and no Official API fallback for sender ${senderPhone}. Dropping. Body: "${message.text?.body || ''}"`
          );
        }
        continue;
      }

      // ── 2. Normal Official API flow (phone_number_id is NOT the sandbox number) ──
      const { data: officialConfigs, error: officialError } =
        await supabaseAdmin()
          .from('whatsapp_config')
          .select('*')
          .eq('phone_number_id', phoneNumberId);

      if (officialError) {
        console.error(
          '[webhook] Error fetching Official API configs:',
          officialError
        );
      }

      if (officialConfigs && officialConfigs.length > 0) {
        if (officialConfigs.length > 1) {
          console.error(
            `[webhook] Multiple configs (${officialConfigs.length}) for phone_number_id ${phoneNumberId}. Dropping.`
          );
          continue;
        }

        const config = officialConfigs[0];
        console.log(
          `[webhook] Matched Official API account: ${config.account_id}`
        );

        // Trial expiration check (for official_api, trial_ends_at is usually null)
        if (
          config.integration_type !== 'official_api' &&
          config.trial_ends_at
        ) {
          if (new Date() > new Date(config.trial_ends_at)) {
            console.warn(
              `[webhook] Trial expired for account ${config.account_id}. Dropping message.`
            );
            continue;
          }
        }

        let decryptedAccessToken: string;
        try {
          decryptedAccessToken = decrypt(config.access_token);
        } catch (err) {
          console.error('[webhook] Failed to decrypt access_token:', err);
          continue;
        }

        for (let i = 0; i < value.messages.length; i++) {
          const message = value.messages[i];
          const contact = value.contacts[i] || value.contacts[0];
          await processMessage(
            message,
            contact,
            config.account_id,
            config.user_id,
            decryptedAccessToken,
            config.phone_number_id
          );
        }
        continue;
      }

      // ── 2a. No Official API match — a saved number that is no longer live? ──
      const retiredProfile = await loadRetiredNumberProfile(
        supabaseAdmin(),
        phoneNumberId
      );
      if (retiredProfile) {
        for (let i = 0; i < value.messages.length; i++) {
          const message = value.messages[i];
          const contact = value.contacts[i] || value.contacts[0];
          const outcome = await replyFromRetiredNumber(
            supabaseAdmin(),
            retiredProfile,
            {
              senderPhone: message.from,
              senderName: contact?.profile?.name ?? null,
              messageId: message.id,
              preview: message.text?.body ?? null,
            }
          );
          console.log(
            `[webhook] Retired number ${phoneNumberId} (account ${retiredProfile.account_id}): ${outcome} for sender ${normalizePhone(message.from)}`
          );
        }
        continue;
      }

      // ── 2b. No Official API match — try Sandbox routing ─────────
      console.log(
        `[webhook] No Official API config for ${phoneNumberId}. Trying sandbox hashtag/sender routing...`
      );

      const fallbackSandboxSystem = await getSandboxSystemConfig();

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i];
        const contact = value.contacts[i] || value.contacts[0];
        const senderPhone = normalizePhone(message.from);

        console.log(
          `[webhook] Attempting sandbox routing for sender: ${senderPhone}, body: "${message.text?.body?.substring(0, 50) || '[non-text]'}"`
        );

        // This number has no Official API config at all, so there is
        // nothing to fall through to — the message is genuinely
        // unroutable. An expired trial still releases its mapping on
        // the way past, so the sender is no longer pinned to a dead
        // tenant the day an official config does exist.
        const live = await resolveLiveSandboxRoute(message, senderPhone);
        if (!live) {
          console.warn(
            `[webhook] No live sandbox route for sender ${senderPhone}, and no Official API config for ${phoneNumberId}. Dropping. Body: "${message.text?.body || ''}"`
          );
          continue;
        }

        const { route, tenantConfig } = live;
        console.log(
          `[webhook] Resolved sandbox route: account=${route.accountId}, code=${route.sandboxCode}, newMapping=${route.isNewMapping}`
        );

        // Resolve owner user_id if not cached in mapping
        const ownerUserId =
          route.userId || (await resolveSandboxOwnerUserId(route.accountId));

        // Rate limit check & atomic increment
        const msgLimit = tenantConfig?.sandbox_message_limit ?? 50;
        const { data: allowed, error: rpcErr } = await supabaseAdmin().rpc(
          'increment_sandbox_message_count',
          {
            p_account_id: route.accountId,
            p_limit: msgLimit,
          }
        );

        if (rpcErr || !allowed) {
          console.warn(
            `[webhook] Sandbox message limit reached or error for account ${route.accountId} (limit: ${msgLimit}). Dropping.`
          );
          continue;
        }

        // Use system sandbox credentials if available; otherwise empty (text-only processing)
        let decryptedSystemToken = '';
        if (
          fallbackSandboxSystem.enabled &&
          fallbackSandboxSystem.access_token
        ) {
          try {
            decryptedSystemToken = decrypt(fallbackSandboxSystem.access_token);
          } catch (err) {
            console.warn(
              '[webhook] Failed to decrypt sandbox system token:',
              err
            );
          }
        } else {
          console.warn(
            '[webhook] Sandbox system credentials not configured. Media downloads may fail, but text processing will continue.'
          );
        }

        await processMessage(
          message,
          contact,
          route.accountId,
          ownerUserId,
          decryptedSystemToken,
          phoneNumberId
        );
      }
      continue;
    }
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile?: { name?: string }; wa_id: string },
  accountId: string,
  configOwnerUserId: string,
  accessToken: string,
  phoneNumberId: string
) {
  // Archived accounts (dormant/expired, see 113_account_archival.sql) must
  // not keep ingesting messages or burning AI credits. getCurrentAccount()
  // blocks the authed API surface, but the webhook is unauthenticated and
  // resolves accountId directly from whatsapp_config — this is the
  // equivalent chokepoint for the inbound-message path. Mirrors the
  // existing "sandbox trial expired ... dropping" guard below.
  const { data: accountRow } = await supabaseAdmin()
    .from('accounts')
    .select('status')
    .eq('id', accountId)
    .maybeSingle();
  if ((accountRow as { status?: string } | null)?.status === 'archived') {
    console.warn(
      `[webhook] Account ${accountId} is archived. Dropping message.`
    );
    return;
  }

  const senderPhone = normalizePhone(message.from);
  const contactName = contact.profile?.name ?? '';

  // A group message reaches us on this same `messages` field, and `from`
  // is the PARTICIPANT. Everything below would therefore file it in that
  // person's private thread and let the bot answer them directly — so
  // groups are split off before any contact or conversation is touched.
  const waGroupId = groupIdFromInbound(message);
  if (waGroupId) {
    const thread = await resolveGroupThread(accountId, waGroupId);
    if (!thread) {
      console.warn(
        `[webhook] group message for unknown group ${waGroupId} on account ${accountId}. Dropping.`
      );
      return;
    }
    const parsed = await parseMessageContent(message, accessToken);
    const senderContactId = await resolveGroupSender(accountId, senderPhone);

    await supabaseAdmin()
      .from('messages')
      .insert({
        conversation_id: thread.conversationId,
        sender_type: 'customer',
        content_type:
          message.type === 'sticker'
            ? 'image'
            : message.type === 'order'
              ? 'text'
              : message.type,
        content_text: parsed.contentText,
        media_url: parsed.mediaUrl,
        message_id: message.id,
        status: 'delivered',
        // In a group the conversation no longer says who wrote this.
        sender_wa_id: senderPhone,
        sender_contact_id: senderContactId,
      });

    await supabaseAdmin()
      .from('conversations')
      .update({
        last_message_text: parsed.contentText || `[${message.type}]`,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', thread.conversationId);

    // No bot, no automations, no flows. Every automated reply path the
    // Engine has answers with buttons or lists, which groups reject
    // outright (130501) — the members would see nothing, and a
    // plain-text fallback would go to all eight of them.
    return;
  }

  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName
  );
  if (!contactOutcome) return;
  const contactRecord = contactOutcome.contact;

  const conversation = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contactRecord.id
  );
  if (!conversation) return;

  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id);
    return;
  }

  const {
    contentText,
    mediaUrl,
    mediaType,
    interactiveReplyId,
    nfmResponseJson,
  } = await parseMessageContent(message, accessToken);

  // Org hierarchy routing (migration 082/083) — only for conversations
  // that aren't already assigned, and only for accounts past Solo Mode
  // (2+ members). Solo accounts skip this entirely: no query, no
  // behavior change, conversation stays unassigned and every message
  // continues to land in the sole user's inbox exactly as before.
  let routingUpdate: {
    assigned_agent_id?: string | null;
    assigned_team_id?: string | null;
    routing_rule_used?: string | null;
    assigned_at?: string | null;
  } = {};
  if (!conversation.assigned_agent_id && !conversation.assigned_team_id) {
    const { count: memberCount } = await supabaseAdmin()
      .from('profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('account_id', accountId);
    if ((memberCount ?? 0) >= 2) {
      const routingResult = await resolveRouting({
        accountId,
        phone: senderPhone,
        messageText: contentText || '',
        contactId: contactRecord.id,
        contactAssignedAgentId: (
          contactRecord as { assigned_agent_id?: string | null }
        ).assigned_agent_id,
        source: (contactRecord as { source?: string | null }).source,
      });
      routingUpdate = {
        assigned_agent_id: routingResult.agentId,
        assigned_team_id: routingResult.teamId,
        routing_rule_used: routingResult.ruleUsed,
        assigned_at: new Date().toISOString(),
      };
    }
  }

  // Click-to-WhatsApp ad attribution: if this message came from an
  // Instagram/Facebook ad, record the referral and stamp the contact.
  // Runs after routing (so routing still sees the pre-existing source)
  // and before the text matcher below — a property linked from the
  // actual ad we created is authoritative, so we skip text matching
  // when it succeeds. No-op for every non-ad message.
  let ctwaLinkedPropertyId: string | null = null;
  if (message.referral) {
    const ctwaResult = await processCtwaReferral({
      admin: supabaseAdmin(),
      accountId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      messageId: message.id,
      referral: message.referral,
      contact: contactRecord,
      contactWasCreated: contactOutcome.wasCreated,
    });
    ctwaLinkedPropertyId = ctwaResult.linkedPropertyId;
  }

  // The listing this message is about, when its code or title names one
  // — the showcase's enquiry button always does. Hoisted so the
  // new-lead alert below can send the enquiry card instead of a generic
  // "someone messaged you".
  let enquiryPropertyId: string | null = null;
  // The property CODE appearing in the message is a deliberate enquiry
  // — nothing puts "PROP-1030" in a buyer's message except the showcase
  // CTA or the buyer copying it on purpose. A TITLE appearing is much
  // weaker: any chat about a listing contains its title, so it counts
  // only for a listing no longer Available that the buyer was not
  // already discussing.
  let enquiryIsDeliberate = false;
  let enquiryPropertyTitle: string | null = null;
  let enquiryPropertyStatus: string | null = null;
  const specificPropertyInterest =
    message.type === 'order' || isDirectPropertyInterest(contentText);
  let propertyReferenceNeedsAgent = false;
  if (contentText && !ctwaLinkedPropertyId) {
    try {
      const { data: properties, error: propertiesError } = await supabaseAdmin()
        .from('properties')
        .select(
          'id, title, property_code, status, is_published, land_area, land_area_unit, area_sqft, area_unit, sublocality, locality_canonical, location, project, tags'
        )
        .eq('account_id', accountId)
        .eq('is_published', true);
      if (propertiesError) throw propertiesError;

      if (properties) {
        const catalogItemCount = message.order?.product_items?.length ?? 0;
        const resolution =
          message.type === 'order' && catalogItemCount !== 1
            ? { kind: 'ambiguous' as const, candidates: [] }
            : resolvePropertyReference(
                contentText,
                properties as PropertyInterestCandidate[],
                contactRecord.last_inquired_property_id
              );

        if (resolution.kind === 'match') {
          const matchedProperty = resolution.property;
          enquiryIsDeliberate = await isDeliberateEnquiry(
            resolution.matchedBy,
            matchedProperty,
            () =>
              listingAlreadyDiscussed(
                accountId,
                conversation.id,
                matchedProperty
              )
          );
          enquiryPropertyId = matchedProperty.id;
          enquiryPropertyTitle = matchedProperty.title;
          enquiryPropertyStatus = matchedProperty.status ?? null;
          await supabaseAdmin()
            .from('contacts')
            .update({
              last_inquired_property_id: matchedProperty.id,
              ...enquiryStatusUpdate(contactOutcome.wasCreated),
              classification:
                contactRecord.classification === 'Others'
                  ? 'Buyer'
                  : contactRecord.classification,
              updated_at: new Date().toISOString(),
            })
            .eq('id', contactRecord.id);
          console.log(
            `[webhook] Linked contact ${contactRecord.id} to property ${matchedProperty.id}`
          );
        } else if (specificPropertyInterest) {
          propertyReferenceNeedsAgent = true;
        }
      }
    } catch (err) {
      propertyReferenceNeedsAgent = specificPropertyInterest;
      console.error('[webhook] Failed to match property from text:', err);
    }
  }

  let replyToInternalId: string | null = null;
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    );
    if (!replyToInternalId) {
      console.warn(
        '[webhook] reply context parent not found:',
        message.context.id
      );
    }
  }

  void mediaType;

  const ALLOWED_CONTENT_TYPES = new Set([
    'text',
    'image',
    'document',
    'audio',
    'video',
    'location',
    'template',
    'interactive',
  ]);
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : 'text';

  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer');
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0;

  const { error: msgError } = await supabaseAdmin()
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: contentType,
      content_text: contentText,
      media_url: mediaUrl,
      message_id: message.id,
      status: 'delivered',
      created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
      reply_to_message_id: replyToInternalId,
      interactive_reply_id: interactiveReplyId,
    });

  if (msgError) {
    if (msgError.code === '23505') {
      console.log(
        `[webhook] Message with ID ${message.id} has already been processed (deduplicated).`
      );
      return;
    }
    console.error('Error inserting message:', msgError);
    return;
  }

  // A fresh inbound re-establishes engagement. Remove any per-recipient
  // marketing cooldown immediately so the next eligible send is not blocked.
  const { error: clearSuppressionError } = await supabaseAdmin()
    .from('contacts')
    .update({
      whatsapp_marketing_suppressed_until: null,
      whatsapp_marketing_suppression_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactRecord.id);
  if (clearSuppressionError) {
    console.error(
      '[webhook] failed to clear marketing suppression after inbound:',
      clearSuppressionError
    );
  }

  // The account owner texting their own Engine number (the WhatsApp
  // lister/self-chat) is not a lead: keep that thread archived and
  // unread-free so it never surfaces in the shared inbox. Checked
  // here (before the conversation update) and reused below for the
  // owner chatbot routing.
  const ownerCheck = await checkIsAccountOwner(senderPhone, accountId);

  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${message.type}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(ownerCheck.isOwner
        ? { unread_count: 0, is_archived: true }
        : {
            unread_count: (conversation.unread_count || 0) + 1,
            awaiting_reply: true,
            status: 'open',
            close_reason: null,
            close_note: null,
            closed_at: null,
            last_customer_message_at: new Date(
              parseInt(message.timestamp) * 1000
            ).toISOString(),
          }),
      ...routingUpdate,
    })
    .eq('id', conversation.id);

  if (convError) {
    console.error('Error updating conversation:', convError);
  }

  await runSerializedInbound<InboundChainPayload>({
    accountId,
    conversationId: conversation.id,
    messageId: message.id,
    payload: {
      message,
      configOwnerUserId,
      phoneNumberId,
      senderPhone,
      contactWasCreated: contactOutcome.wasCreated,
      contactRecord,
      conversation,
      contentText,
      interactiveReplyId,
      nfmResponseJson,
      routingUpdate,
      enquiryPropertyId,
      enquiryIsDeliberate,
      enquiryPropertyTitle,
      enquiryPropertyStatus,
      specificPropertyInterest,
      propertyReferenceNeedsAgent,
      isFirstInboundMessage,
      ownerCheck,
    },
    handle: (payload, info) =>
      handleInboundChain(payload, info, accountId, accessToken),
    handleWithoutPayload: (deferredId) =>
      qualifyDeferredLine(
        deferredId,
        contactRecord,
        conversation,
        accountId,
        accessToken,
        phoneNumberId,
        configOwnerUserId
      ),
  });
}

async function listingAlreadyDiscussed(
  accountId: string,
  conversationId: string,
  property: { title: string; property_code?: string | null }
): Promise<boolean> {
  const needles = [property.title, property.property_code].filter(
    (value): value is string => Boolean(value && value.trim())
  );
  for (const needle of needles) {
    const { data, error } = await supabaseAdmin()
      .from('messages')
      .select('id')
      .eq('account_id', accountId)
      .eq('conversation_id', conversationId)
      .neq('sender_type', 'customer')
      .ilike('content_text', `%${needle.replace(/[\\%_]/g, '\\$&')}%`)
      .limit(1);
    if (error) {
      console.error('[webhook] listing history lookup failed:', error);
      return true;
    }
    if (data && data.length > 0) return true;
  }
  return false;
}

async function qualifyDeferredLine(
  messageId: string,
  contactRecord: ContactRow,
  conversation: ConversationRow,
  accountId: string,
  accessToken: string,
  phoneNumberId: string,
  configOwnerUserId: string
) {
  const { data } = await supabaseAdmin()
    .from('messages')
    .select('content_type, content_text')
    .eq('conversation_id', conversation.id)
    .eq('message_id', messageId)
    .maybeSingle();
  const line = data?.content_type === 'text' ? data.content_text : null;
  console.error(
    `[webhook] deferred message ${messageId} carried no payload; ${line ? 'qualifying it only' : 'nothing to rerun'}`
  );
  if (!line) return;
  await processBuyerQualificationMessage(
    line,
    contactRecord,
    conversation,
    accountId,
    accessToken,
    phoneNumberId,
    configOwnerUserId,
    messageId
  );
}

async function parseMessageContent(
  message: WhatsAppMessage,
  // accessToken no longer needed — media is proxied on demand
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _accessToken: string
): Promise<{
  contentText: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  interactiveReplyId: string | null;
  /** Raw response_json of a completed native Meta Flow (nfm_reply). */
  nfmResponseJson: string | null;
}> {
  const buildMediaUrl = (mediaId: string): string => {
    // Build the proxy URL without pre-verifying with Meta.
    // The /api/whatsapp/media/[mediaId] proxy already handles
    // unavailable or expired media IDs gracefully with a 404.
    return `/api/whatsapp/media/${mediaId}`;
  };

  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
    nfmResponseJson: null,
  };

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null };

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: buildMediaUrl(message.image.id),
          mediaType: message.image.mime_type,
        };
      }
      return empty;

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: buildMediaUrl(message.video.id),
          mediaType: message.video.mime_type,
        };
      }
      return empty;

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: buildMediaUrl(message.document.id),
          mediaType: message.document.mime_type,
        };
      }
      return empty;

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: buildMediaUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        };
      }
      return empty;

    case 'sticker':
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: buildMediaUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        };
      }
      return empty;

    case 'location':
      if (message.location) {
        const loc = message.location;
        // Emit the canonical Maps URL rather than a bare coordinate pair:
        // it renders as a tappable link in the inbox, and the listing
        // intake resolves it into the pin's locality/city/coordinates.
        const locationText = [
          loc.name,
          loc.address,
          googleMapsUrlForCoordinates(loc.latitude, loc.longitude),
        ]
          .filter(Boolean)
          .join(' - ');
        return { ...empty, contentText: locationText };
      }
      return empty;

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null };

    case 'button':
      if (message.button) {
        return {
          ...empty,
          contentText: `🔘 Button: "${message.button.text}"`,
          // Template quick replies deliver their send-time payload here —
          // surfacing it as interactiveReplyId routes taps through the
          // same handlers as free-form interactive buttons. Payloads
          // without a registered prefix (Meta defaults them to the button
          // text) simply fall through unchanged.
          interactiveReplyId: message.button.payload || null,
        };
      }
      return { ...empty, contentText: '[Button message]' };

    case 'interactive': {
      if (
        message.interactive?.type === 'nfm_reply' &&
        message.interactive.nfm_reply
      ) {
        return {
          ...empty,
          contentText:
            message.interactive.nfm_reply.body || '📋 Form submitted',
          nfmResponseJson: message.interactive.nfm_reply.response_json,
        };
      }
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply;
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        };
      }
      return { ...empty, contentText: '[Interactive reply]' };
    }

    case 'contacts': {
      if (message.contacts && message.contacts.length > 0) {
        const summaries = message.contacts.map((c) => {
          const name = c.name?.formatted_name || 'Shared Contact';
          const phones = c.phones?.map((p) => p.phone).join(', ') || '';
          return `${name} (${phones})`;
        });
        return {
          ...empty,
          contentText: `${SHARED_CARDS_HEADER}\n${summaries.join('\n')}`,
        };
      }
      return { ...empty, contentText: '📥 Shared Contact Card' };
    }

    case 'order':
      return {
        ...empty,
        contentText: buildCatalogOrderMessage(message.order),
      };

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      };
  }
}

export interface ContactRow {
  id: string;
  account_id: string;
  user_id: string | null;
  phone: string;
  secondary_phones?: string[] | null;
  name: string;
  classification?: string;
  last_inquired_property_id?: string | null;
  owner_digest_consent?: string | null;
  owner_digest_consent_requested_at?: string | null;
  is_merged?: boolean;
  merged_into_id?: string | null;
}

export interface PropertyRow {
  id: string;
  title: string;
  price: number | string | null;
  area_sqft: number | null;
  area_unit: string | null;
  bedrooms: number | null;
  type?: string | null;
  land_area?: number | null;
  land_area_unit?: string | null;
  sublocality?: string | null;
  city?: string | null;
  state?: string | null;
  location?: string | null;
  location_privacy?: string | null;
  description?: string | null;
  google_map_link?: string | null;
  images?: string[] | null;
  bathrooms?: number | null;
}

interface ContactOutcome {
  contact: ContactRow;
  wasCreated: boolean;
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  const normalizedSender = phone.replace(/\D/g, '');
  const phoneSuffix =
    normalizedSender.length >= 8
      ? normalizedSender.slice(-8)
      : normalizedSender;

  const { data: contacts, error: contactsError } = await supabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .like('phone', `%${phoneSuffix}`);

  if (contactsError) {
    console.error('Error fetching contacts:', contactsError);
    return null;
  }

  const matchingContacts = (contacts ?? []).filter((c: ContactRow) =>
    phonesMatch(c.phone, phone)
  );
  let existingContact = matchingContacts.find(
    (c: ContactRow) => !c.is_merged
  ) as ContactRow | undefined;

  if (!existingContact) {
    const alias = matchingContacts.find(
      (c: ContactRow) => c.is_merged && c.merged_into_id
    ) as ContactRow | undefined;
    if (alias?.merged_into_id) {
      const { data: mergeWinner } = await supabaseAdmin()
        .from('contacts')
        .select('*')
        .eq('id', alias.merged_into_id)
        .eq('account_id', accountId)
        .eq('is_merged', false)
        .maybeSingle();
      existingContact = mergeWinner as ContactRow | undefined;
    }
  }

  if (existingContact) {
    // Only adopt the sender's WhatsApp profile name when the contact has
    // no real name yet (blank, or still just the phone number). A name the
    // user saved by hand must never be clobbered by the sender's own
    // WhatsApp display name — instead record that display name as a note
    // (once) so the information isn't lost.
    const storedName = (existingContact.name || '').trim();
    const phoneDigits = phone.replace(/\D/g, '');
    const isPlaceholderName =
      !storedName || storedName.replace(/\D/g, '') === phoneDigits;

    if (name && name !== existingContact.name) {
      if (isPlaceholderName) {
        await supabaseAdmin()
          .from('contacts')
          .update({ name, updated_at: new Date().toISOString() })
          .eq('id', existingContact.id);
        existingContact.name = name;
      } else if (name.replace(/\D/g, '') !== phoneDigits) {
        await recordWhatsAppProfileName(
          accountId,
          configOwnerUserId,
          existingContact.id,
          name
        );
      }
    }
    return { contact: existingContact, wasCreated: false };
  }

  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
      source: 'WhatsApp',
    })
    .select()
    .single();

  if (createError) {
    console.error('Error creating contact:', createError);
    return null;
  }

  return { contact: newContact, wasCreated: true };
}

/** Log the sender's current WhatsApp profile name against a contact whose
 *  name the user set by hand, so the display name is captured without
 *  overwriting the saved name. Deduped on the exact note text so it isn't
 *  re-added on every inbound message. */
async function recordWhatsAppProfileName(
  accountId: string,
  userId: string,
  contactId: string,
  profileName: string
): Promise<void> {
  const noteText = `WhatsApp profile name: ${profileName}`;
  const { data: existing } = await supabaseAdmin()
    .from('contact_notes')
    .select('id')
    .eq('contact_id', contactId)
    .eq('note_text', noteText)
    .limit(1);
  if (existing && existing.length > 0) return;
  await supabaseAdmin().from('contact_notes').insert({
    contact_id: contactId,
    account_id: accountId,
    user_id: userId,
    note_text: noteText,
  });
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string
) {
  const { conversation, error } = await resolveConversation<ConversationRow>(
    supabaseAdmin(),
    {
      accountId,
      contactId,
      userId: configOwnerUserId,
    }
  );

  if (error) {
    console.error('Error creating conversation:', error);
    return null;
  }

  return conversation;
}
