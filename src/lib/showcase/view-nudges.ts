import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupConversation } from '@/lib/conversations/resolve';
import { withContactConversationLease } from '@/lib/conversations/outbound-lease';
import { resolveQuietPeriod } from '@/lib/notifications/quiet-hours';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import { decrypt } from '@/lib/whatsapp/encryption';
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';
import {
  SHOWCASE_VIEW_NUDGE_TEMPLATE_NAME,
  buildViewNudgeButtonsBody,
  buildViewNudgeParams,
  buildViewNudgeTemplatePayload,
  renderViewNudgeBody,
  usableViewNudgeTemplate,
  viewNudgeButtonParams,
  viewNudgeButtons,
} from '@/lib/showcase/view-nudge-template';
import type { MessageTemplate } from '@/types';

export const VIEW_NUDGE_MIN_DWELL_MS = 30_000;
export const VIEW_NUDGE_SETTLE_MINUTES = 30;
export const VIEW_NUDGE_LOOKBACK_HOURS = 24;
export const VIEW_NUDGE_COOLDOWN_DAYS = 3;
export const VIEW_NUDGE_BATCH = 50;

export interface ViewNudgeCandidate {
  account_id: string;
  contact_id: string;
  property_id: string;
  dwell_ms: number;
  viewed_at: string;
}

type SendOutcome =
  | {
      status: 'sent';
      messageId: string | null;
      channel: 'buttons' | 'template';
    }
  | { status: 'skipped'; reason: string }
  | { status: 'deferred' }
  | { status: 'retry' };

export async function ensureViewNudgeTemplate(
  db: SupabaseClient,
  accountId: string
): Promise<MessageTemplate[]> {
  const { data: rows, error } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', SHOWCASE_VIEW_NUDGE_TEMPLATE_NAME);
  if (error) {
    console.error('[view-nudges] template lookup failed:', error);
    return [];
  }
  if (rows && rows.length > 0) return rows as MessageTemplate[];

  try {
    const { data: config } = await db
      .from('whatsapp_config')
      .select('waba_id, access_token, integration_type')
      .eq('account_id', accountId)
      .maybeSingle();
    if (
      !config?.waba_id ||
      !config.access_token ||
      config.integration_type === 'sandbox'
    ) {
      return [];
    }

    const { data: account } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .maybeSingle();
    if (!account?.owner_user_id) return [];

    const payload = buildViewNudgeTemplatePayload();
    const meta = await submitMessageTemplate({
      wabaId: config.waba_id as string,
      accessToken: decrypt(config.access_token as string),
      payload: buildMetaTemplatePayload(payload),
    });

    const row = {
      account_id: accountId,
      user_id: account.owner_user_id,
      name: payload.name,
      category: payload.category,
      language: payload.language,
      body_text: payload.body_text,
      footer_text: payload.footer_text ?? null,
      buttons: payload.buttons ?? null,
      sample_values: payload.sample_values ?? null,
      status: normalizeStatus(meta.status),
      meta_template_id: meta.id,
      submission_error: null,
      last_submitted_at: new Date().toISOString(),
    };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error: insertError } = await db
        .from('message_templates')
        .insert(row);
      if (!insertError) break;
      console.error(
        `[view-nudges] submitted ${payload.name} (Meta id ${meta.id}) but could not record it (attempt ${attempt}):`,
        insertError
      );
    }
    console.log(
      `[view-nudges] auto-submitted ${payload.name} for account ${accountId} (status ${meta.status})`
    );
  } catch (err) {
    console.error('[view-nudges] template auto-submit failed:', err);
  }
  return [];
}

export async function processShowcaseViewNudges(
  db: SupabaseClient,
  now: Date = new Date()
): Promise<{ sent: number; skipped: number; failed: number }> {
  const totals = { sent: 0, skipped: 0, failed: 0 };
  const { data, error } = await db.rpc('showcase_view_nudge_candidates', {
    p_min_dwell_ms: VIEW_NUDGE_MIN_DWELL_MS,
    p_settle_minutes: VIEW_NUDGE_SETTLE_MINUTES,
    p_lookback_hours: VIEW_NUDGE_LOOKBACK_HOURS,
    p_cooldown_days: VIEW_NUDGE_COOLDOWN_DAYS,
    p_limit: VIEW_NUDGE_BATCH,
  });
  if (error) {
    console.error('[view-nudges] candidate query failed:', error);
    return totals;
  }

  const quietByAccount = new Map<string, boolean>();
  for (const candidate of (data ?? []) as ViewNudgeCandidate[]) {
    let quiet = quietByAccount.get(candidate.account_id);
    if (quiet === undefined) {
      quiet = (await resolveQuietPeriod(candidate.account_id, 'client', now))
        .isQuiet;
      quietByAccount.set(candidate.account_id, quiet);
    }
    if (quiet) continue;

    const { data: nudgeId, error: claimError } = await db.rpc(
      'claim_showcase_view_nudge',
      {
        p_account_id: candidate.account_id,
        p_contact_id: candidate.contact_id,
        p_property_id: candidate.property_id,
        p_dwell_ms: candidate.dwell_ms,
        p_viewed_at: candidate.viewed_at,
      }
    );
    if (claimError) {
      console.error('[view-nudges] claim failed:', claimError);
      continue;
    }
    if (!nudgeId) continue;

    const leased = await withContactConversationLease(
      db,
      candidate.account_id,
      candidate.contact_id,
      () => sendViewNudge(db, candidate)
    );
    const outcome: SendOutcome =
      leased.status === 'ran' ? leased.value : { status: 'retry' };

    if (outcome.status === 'deferred') {
      const { error: releaseError } = await db
        .from('showcase_view_nudges')
        .delete()
        .eq('id', nudgeId as string)
        .eq('account_id', candidate.account_id);
      if (releaseError) {
        console.error(
          `[view-nudges] failed to release ${nudgeId}:`,
          releaseError
        );
      }
      totals.skipped++;
      continue;
    }

    const update =
      outcome.status === 'sent'
        ? {
            status: 'sent',
            sent_at: new Date().toISOString(),
            message_id: outcome.messageId,
            channel: outcome.channel,
          }
        : outcome.status === 'skipped'
          ? { status: 'skipped', skip_reason: outcome.reason }
          : { status: 'failed' };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error: markError } = await db
        .from('showcase_view_nudges')
        .update(update)
        .eq('id', nudgeId as string)
        .eq('account_id', candidate.account_id);
      if (!markError) break;
      console.error(
        `[view-nudges] failed to mark ${nudgeId} (attempt ${attempt}):`,
        markError
      );
    }

    if (outcome.status === 'sent') totals.sent++;
    else if (outcome.status === 'skipped') totals.skipped++;
    else totals.failed++;
  }
  return totals;
}

async function sendViewNudge(
  db: SupabaseClient,
  candidate: ViewNudgeCandidate
): Promise<SendOutcome> {
  const { account_id: accountId, contact_id: contactId } = candidate;

  const { conversation, error: conversationError } = await lookupConversation<{
    id: string;
    last_customer_message_at: string | null;
  }>(db, { accountId, contactId, columns: 'id, last_customer_message_at' });
  if (conversationError) return { status: 'retry' };
  if (
    conversation?.last_customer_message_at &&
    conversation.last_customer_message_at >= candidate.viewed_at
  ) {
    return { status: 'skipped', reason: 'replied_since_view' };
  }
  const { data: recentActivity, error: recentActivityError } = await db
    .from('showcase_events')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .gt(
      'created_at',
      new Date(Date.now() - VIEW_NUDGE_SETTLE_MINUTES * 60_000).toISOString()
    )
    .limit(1)
    .maybeSingle();
  if (recentActivityError) return { status: 'retry' };
  if (recentActivity) return { status: 'deferred' };
  if (conversation?.id) {
    const { data: agentMessage, error: agentMessageError } = await db
      .from('messages')
      .select('id')
      .eq('account_id', accountId)
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'agent')
      .gte('created_at', candidate.viewed_at)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    if (agentMessageError) return { status: 'retry' };
    if (agentMessage) return { status: 'skipped', reason: 'agent_in_touch' };
  }

  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('user_id')
    .eq('account_id', accountId)
    .maybeSingle();
  if (configError) return { status: 'retry' };
  if (!config?.user_id) return { status: 'skipped', reason: 'no_whatsapp' };

  const { data: contact, error: contactError } = await db
    .from('contacts')
    .select('name, buyer_alerts_consent')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (contactError) return { status: 'retry' };
  if (!contact) return { status: 'skipped', reason: 'contact_missing' };
  if (contact.buyer_alerts_consent === 'declined') {
    return { status: 'skipped', reason: 'alerts_declined' };
  }

  const { data: property, error: propertyError } = await db
    .from('properties')
    .select('id, title, status')
    .eq('id', candidate.property_id)
    .eq('account_id', accountId)
    .maybeSingle();
  if (propertyError) return { status: 'retry' };
  if (!property || property.status !== 'Available') {
    return { status: 'skipped', reason: 'property_unavailable' };
  }

  const params = buildViewNudgeParams(
    contact.name as string | null,
    (property.title as string | null) || 'Property'
  );

  try {
    if (isWithinCustomerWindow(conversation?.last_customer_message_at)) {
      const result = await sendWhatsAppMessageAndPersist({
        accountId,
        userId: config.user_id,
        contactId,
        kind: 'interactive',
        senderType: 'bot',
        interactiveType: 'buttons',
        interactiveBody: buildViewNudgeButtonsBody(params),
        interactiveButtons: viewNudgeButtons(property.id as string),
        customDbClient: db,
      });
      if (result?.success === false && !result.reachedMeta) {
        return { status: 'retry' };
      }
      return {
        status: 'sent',
        messageId: result?.whatsappMessageId ?? null,
        channel: 'buttons',
      };
    }

    const template = usableViewNudgeTemplate(
      await ensureViewNudgeTemplate(db, accountId),
      contact.buyer_alerts_consent as string | null
    );
    if (!template) return { status: 'deferred' };

    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId: config.user_id,
      contactId,
      kind: 'template',
      senderType: 'bot',
      templateName: template.name,
      templateLanguage: template.language || 'en_US',
      templateParams: params,
      messageParams: {
        body: params,
        buttonParams: viewNudgeButtonParams(property.id as string),
      },
      templateRow: template,
      text: renderViewNudgeBody(params),
      customDbClient: db,
    });
    if (result?.success === false && !result.reachedMeta) {
      return { status: 'retry' };
    }
    return {
      status: 'sent',
      messageId: result?.whatsappMessageId ?? null,
      channel: 'template',
    };
  } catch (err) {
    console.error(
      `[view-nudges] send failed for contact ${contactId} on ${property.id}:`,
      err
    );
    return { status: 'retry' };
  }
}
