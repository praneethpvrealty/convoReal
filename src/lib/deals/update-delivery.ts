import type { SupabaseClient } from '@supabase/supabase-js';

import { createNotification } from '@/lib/notifications/create';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { phonesMatch } from '@/lib/whatsapp/phone-utils';
import {
  buildPurchaseProgressParams,
  pickPurchaseProgressTemplate,
  PURCHASE_PROGRESS_TEMPLATE_NAME,
} from '@/lib/whatsapp/purchase-progress-template';
import {
  narrowToLanguage,
  resolveSendLanguage,
} from '@/lib/whatsapp/template-language';

import { writeDealEvent } from './events';
import type { DealMilestoneStatus } from './milestones';
import { dealShareUrl, mintDealShareToken, ttlMsForKey } from './share-links';
import type { DealStakeholder } from './stakeholders';
import {
  engineDeliveryMode,
  renderUpdateNotice,
  updateNoticeUrl,
  type DealUpdateSnapshot,
  type SnapshotSources,
  type UpdateChannel,
  type UpdateDeliveryMode,
} from './updates';
import type { DealVisibility } from './visibility';

/**
 * Server-side delivery of a published update.
 *
 * The Engine sends a notice through the business number only when it
 * can do so honestly: free-form inside the recipient's 24-hour window,
 * and outside it only the approved purchase-progress template, only to
 * the buyer whose purchase it is. Personal WhatsApp is a handoff the
 * app never sends. Every outcome lands on the recipient row as its own
 * fact.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TEMPLATE_FOLLOW_UP_WINDOW_MS = 30 * DAY_MS;

export function publicSiteUrl(request?: Request): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (request ? new URL(request.url).origin : '')
  );
}

interface TemplateRow {
  name: string;
  language?: string | null;
  status?: string | null;
  category?: string | null;
  body_text: string;
}

export interface RecipientPlan {
  stakeholder: DealStakeholder;
  channel: UpdateChannel;
  contactId: string | null;
  contactName: string | null;
  conversationId: string | null;
  mode: UpdateDeliveryMode | null;
  reason: string | null;
  template: TemplateRow | null;
}

async function resolveStakeholderContact(
  db: SupabaseClient,
  accountId: string,
  stakeholder: Pick<DealStakeholder, 'contact_id' | 'phone'>
): Promise<{ id: string; name: string | null; phone: string | null } | null> {
  if (stakeholder.contact_id) {
    const { data } = await db
      .from('contacts')
      .select('id, name, phone')
      .eq('id', stakeholder.contact_id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (data)
      return data as { id: string; name: string | null; phone: string | null };
  }
  const digits = (stakeholder.phone ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  const { data: rows } = await db
    .from('contacts')
    .select('id, name, phone')
    .eq('account_id', accountId)
    .like('phone', `%${digits.slice(-10)}`)
    .limit(10);
  const match = (
    (rows ?? []) as { id: string; name: string | null; phone: string | null }[]
  ).find((c) => c.phone && phonesMatch(c.phone, digits));
  return match ?? null;
}

async function loadApprovedPurchaseProgressTemplate(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<TemplateRow | null> {
  const language = await resolveSendLanguage(db, accountId, contactId);
  const { data: rows } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', PURCHASE_PROGRESS_TEMPLATE_NAME);
  return pickPurchaseProgressTemplate(
    narrowToLanguage((rows ?? []) as TemplateRow[], language)
  );
}

/** Decide how one recipient will be reached. Read-only: the preview
 *  and the publish run the same plan. */
export async function planRecipientDelivery(
  db: SupabaseClient,
  accountId: string,
  stakeholder: DealStakeholder,
  channel: UpdateChannel
): Promise<RecipientPlan> {
  const base: RecipientPlan = {
    stakeholder,
    channel,
    contactId: null,
    contactName: null,
    conversationId: null,
    mode: null,
    reason: null,
    template: null,
  };
  if (channel === 'portal_only') return { ...base, mode: 'portal' };
  if (channel === 'personal_whatsapp') {
    return stakeholder.phone
      ? { ...base, mode: 'handoff' }
      : { ...base, reason: 'No WhatsApp number on file for them.' };
  }

  const contact = await resolveStakeholderContact(db, accountId, stakeholder);
  if (!contact) {
    return {
      ...base,
      reason:
        'They are not a contact in this account, so the business number cannot message them. Add them to Contacts with this number, or hand the link over from your phone.',
    };
  }
  const { data: conversation } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  let lastCustomerAt: string | null = null;
  if (conversation) {
    const { data: last } = await db
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lastCustomerAt =
      (last as { created_at?: string } | null)?.created_at ?? null;
  }
  const withinWindow = isWithinCustomerWindow(lastCustomerAt);
  const template =
    !withinWindow && stakeholder.side === 'buyer'
      ? await loadApprovedPurchaseProgressTemplate(db, accountId, contact.id)
      : null;
  const decision = engineDeliveryMode({
    side: stakeholder.side,
    withinWindow,
    templateApproved: Boolean(template),
  });
  return {
    ...base,
    contactId: contact.id,
    contactName: contact.name,
    conversationId: (conversation as { id: string } | null)?.id ?? null,
    mode: decision.mode,
    reason: decision.mode ? null : decision.reason,
    template,
  };
}

function resolveBodyText(body: string, params: string[]): string {
  return (body || '').replace(
    /\{\{(\d+)\}\}/g,
    (_, n) => params[Number(n) - 1] ?? ''
  );
}

export interface EngineSendResult {
  success: boolean;
  messageId: string | null;
  error: string | null;
}

/** The Engine send for a planned recipient. `text` is the rendered
 *  notice (free-form); the template path sends the headline as the
 *  purchase step and delivers the link when the buyer taps. */
export async function sendEngineNotice(args: {
  accountId: string;
  userId: string;
  plan: RecipientPlan;
  text: string;
  headline: string;
  brandName: string;
  propertyLabel: string | null;
  dealTitle: string;
}): Promise<EngineSendResult> {
  const { plan } = args;
  if (!plan.contactId || !plan.mode) {
    return {
      success: false,
      messageId: null,
      error: plan.reason ?? 'Not deliverable',
    };
  }
  if (plan.mode === 'free_form') {
    const result = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      userId: args.userId,
      contactId: plan.contactId,
      conversationId: plan.conversationId,
      kind: 'text',
      senderType: 'bot',
      text: args.text,
    });
    return {
      success: result.success,
      messageId: result.messageId ?? null,
      error: result.success ? null : (result.error ?? 'Send failed'),
    };
  }
  if (plan.mode === 'template' && plan.template) {
    const params = buildPurchaseProgressParams(
      plan.contactName ?? plan.stakeholder.name,
      args.brandName,
      args.propertyLabel || args.dealTitle,
      args.headline
    );
    const result = await sendWhatsAppMessageAndPersist({
      accountId: args.accountId,
      userId: args.userId,
      contactId: plan.contactId,
      conversationId: plan.conversationId,
      kind: 'template',
      senderType: 'bot',
      templateName: plan.template.name,
      templateLanguage: plan.template.language || 'en_US',
      templateParams: [...params],
      messageParams: { body: [...params] },
      templateRow: plan.template,
      text: resolveBodyText(plan.template.body_text, [...params]),
    });
    return {
      success: result.success,
      messageId: result.messageId ?? null,
      error: result.success ? null : (result.error ?? 'Send failed'),
    };
  }
  return { success: false, messageId: null, error: 'Not an Engine delivery' };
}

/** Everything the composer can quote, read under the caller's RLS. */
export async function loadUpdateSources(
  db: SupabaseClient,
  accountId: string,
  dealId: string
): Promise<SnapshotSources> {
  const [{ data: deal }, { data: milestones }, { data: events }] =
    await Promise.all([
      db
        .from('deals')
        .select(
          'property:properties(title, unit_no), stage:pipeline_stages(name)'
        )
        .eq('id', dealId)
        .eq('account_id', accountId)
        .maybeSingle(),
      db
        .from('deal_milestones')
        .select(
          'id, title, status, position, target_date, completed_at, visibility'
        )
        .eq('deal_id', dealId)
        .eq('account_id', accountId)
        .order('position'),
      db
        .from('deal_events')
        .select('id, event_type, title, created_at, visibility')
        .eq('deal_id', dealId)
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);
  const one = <T>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const row = (deal ?? null) as {
    property?:
      | { title: string | null; unit_no: string | null }
      | { title: string | null; unit_no: string | null }[]
      | null;
    stage?: { name: string } | { name: string }[] | null;
  } | null;
  const property = one(row?.property ?? null);
  return {
    property_label: property?.unit_no
      ? `Property No. ${property.unit_no}`
      : (property?.title ?? null),
    stage: one(row?.stage ?? null)?.name ?? null,
    milestones: (
      (milestones ?? []) as SnapshotSources['milestones'][number][]
    ).map((m) => ({ ...m, status: m.status as DealMilestoneStatus })),
    events: (events ?? []) as Array<
      SnapshotSources['events'][number] & { visibility: DealVisibility }
    >,
  };
}

/**
 * A buyer's tap on a purchase-progress notice that carried an update.
 * The tap reopens the 24-hour window, so the private link the template
 * could not carry goes now, free-form; the tap itself is recorded as
 * the acknowledgement and the agent is told what the buyer said.
 * Returns false when no template-delivered update is waiting for this
 * contact, so the closing-nudge handler gets its turn.
 */
export async function handleUpdateNoticeReply(args: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  contact: { id: string; name: string | null };
  conversationId: string;
  onTrack: boolean;
}): Promise<boolean> {
  const { db, accountId } = args;
  const since = new Date(
    Date.now() - TEMPLATE_FOLLOW_UP_WINDOW_MS
  ).toISOString();
  const { data: recipient } = await db
    .from('deal_update_recipients')
    .select(
      'id, update_id, deal_id, stakeholder_id, link_ttl_ms, link_otp_required, ' +
        'update:deal_updates(id, headline, body, snapshot, supersedes_update_id), ' +
        'stakeholder:deal_stakeholders(id, name, email, side)'
    )
    .eq('account_id', accountId)
    .eq('contact_id', args.contact.id)
    .eq('delivery_mode', 'template')
    .eq('status', 'sent')
    .is('link_delivered_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!recipient) return false;

  type UpdateRow = {
    id: string;
    headline: string;
    body: string | null;
    snapshot: DealUpdateSnapshot;
    supersedes_update_id: string | null;
  };
  type StakeholderRow = {
    id: string;
    name: string;
    email: string | null;
    side: string;
  };
  const one = <T>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const row = recipient as unknown as {
    id: string;
    update_id: string;
    deal_id: string;
    stakeholder_id: string;
    link_ttl_ms: number | null;
    link_otp_required: boolean;
    update: UpdateRow | UpdateRow[] | null;
    stakeholder: StakeholderRow | StakeholderRow[] | null;
  };
  const update = one(row.update);
  const stakeholder = one(row.stakeholder);
  if (!update || !stakeholder) return false;

  const [{ data: deal }, { data: account }] = await Promise.all([
    db
      .from('deals')
      .select('title, contact_id')
      .eq('id', row.deal_id)
      .eq('account_id', accountId)
      .maybeSingle(),
    db.from('accounts').select('name').eq('id', accountId).maybeSingle(),
  ]);
  const dealTitle =
    (deal as { title?: string } | null)?.title ?? 'your transaction';
  const brandName =
    (account as { name?: string | null } | null)?.name || 'your agent';

  const minted = mintDealShareToken(row.link_ttl_ms ?? ttlMsForKey('7d'));
  const { data: link, error: linkError } = await db
    .from('deal_share_links')
    .insert({
      account_id: accountId,
      deal_id: row.deal_id,
      stakeholder_id: row.stakeholder_id,
      token_hash: minted.hash,
      token_prefix: minted.prefix,
      expires_at: minted.expiresAt,
      otp_required: row.link_otp_required && Boolean(stakeholder.email),
      created_by: null,
    })
    .select('id')
    .single();
  if (linkError || !link) {
    console.error('[update-delivery] link mint failed:', linkError?.message);
    return false;
  }

  const text = renderUpdateNotice({
    recipientName: stakeholder.name,
    brandName,
    dealTitle,
    headline: update.headline,
    body: update.body,
    snapshot: update.snapshot,
    url: updateNoticeUrl(
      dealShareUrl(minted.token, publicSiteUrl()),
      update.id
    ),
    correction: Boolean(update.supersedes_update_id),
  });
  const sent = await sendWhatsAppMessageAndPersist({
    accountId,
    userId: args.ownerUserId,
    contactId: args.contact.id,
    conversationId: args.conversationId,
    kind: 'text',
    senderType: 'bot',
    text,
  });

  const now = new Date().toISOString();
  const { error: recError } = await db
    .from('deal_update_recipients')
    .update({
      link_id: link.id,
      link_delivered_at: sent.success ? now : null,
      acknowledged_at: now,
      acknowledged_via: 'whatsapp',
    })
    .eq('id', row.id)
    .eq('account_id', accountId)
    .select('id');
  if (recError)
    console.error(
      '[update-delivery] recipient update failed:',
      recError.message
    );

  const answer = args.onTrack ? 'paperwork on track' : 'something is pending';
  const outcome = await writeDealEvent({
    db,
    accountId,
    dealId: row.deal_id,
    eventType: 'update_acknowledged',
    title: `${stakeholder.name} replied "${answer}" to "${update.headline}"`,
    actorId: null,
    actorName: stakeholder.name,
    source: 'system',
    metadata: {
      update_id: update.id,
      recipient_id: row.id,
      via: 'whatsapp',
      on_track: args.onTrack,
    },
  });
  if (!outcome.ok)
    console.warn('[update-delivery] event not written:', outcome.error);

  const { data: contactRow } = await db
    .from('contacts')
    .select('assigned_agent_id')
    .eq('id', args.contact.id)
    .eq('account_id', accountId)
    .maybeSingle();
  const agentUserId =
    (contactRow as { assigned_agent_id?: string | null } | null)
      ?.assigned_agent_id || args.ownerUserId;
  await createNotification({
    accountId,
    userId: agentUserId,
    type: 'new_message',
    title: args.onTrack
      ? `🧾 ${stakeholder.name}: paperwork on track`
      : `🧾 ${stakeholder.name}: something is pending`,
    body: `Replied to your update "${update.headline}" on ${dealTitle}.${sent.success ? ' Their private link has been sent.' : ' The link could not be sent — open the thread.'}`,
    entityType: 'deal',
    entityId: row.deal_id,
    link: `/deals/${row.deal_id}`,
    channels: { inApp: true, push: true, whatsapp: false },
  });
  return true;
}
