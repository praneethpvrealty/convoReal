import type { SupabaseClient } from '@supabase/supabase-js';

import { createNotification } from '@/lib/notifications/create';
import { resolveChannels } from '@/lib/notifications/preferences';
import { isReengagementError } from '@/lib/whatsapp/customer-window';
import { LOCATION_OWNER_DECISION_TEMPLATE_NAME } from '@/lib/whatsapp/location-request-templates';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder';
import {
  loadTemplateForContact,
  warnLanguageFallback,
} from '@/lib/whatsapp/template-language';
import {
  normalizePhoneWithCountryCode,
  phonesMatch,
} from '@/lib/whatsapp/phone-utils';
import {
  resolveOwnerWhatsAppContact,
  resolveOwnerUserId,
} from '@/lib/inventory/location-requests';
import type { MessageTemplate } from '@/types';

export const DOCUMENT_APPROVE_PREFIX = 'docreq_owner_approve:';
export const DOCUMENT_REJECT_PREFIX = 'docreq_owner_reject:';

export interface DocumentRequestRow {
  id: string;
  property_id: string;
  account_id: string;
  requester_name: string;
  requester_phone: string;
  requester_email?: string | null;
  status: string;
  access_password?: string | null;
}

interface DocumentProperty {
  id: string;
  title: string;
  property_code: string | null;
  documents: unknown;
  user_id?: string | null;
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://app.convoreal.com'
  ).replace(/\/+$/, '');
}

function renderTemplate(body: string, params: string[]): string {
  return params.reduce(
    (text, value, index) => text.replaceAll(`{{${index + 1}}`, value),
    body
  );
}

async function loadProperty(
  admin: SupabaseClient,
  request: Pick<DocumentRequestRow, 'account_id' | 'property_id'>
): Promise<DocumentProperty | null> {
  const { data } = await admin
    .from('properties')
    .select('id, title, property_code, documents, user_id')
    .eq('id', request.property_id)
    .eq('account_id', request.account_id)
    .maybeSingle();
  return (data as DocumentProperty | null) ?? null;
}

export async function decideDocumentRequest(args: {
  admin: SupabaseClient;
  request: DocumentRequestRow;
  decision: 'approve' | 'reject';
  actorUserId: string;
  accessPassword?: string | null;
}): Promise<{ shareLink: string | null; delivered: boolean }> {
  if (args.request.status !== 'pending') {
    throw new Error('This request has already been processed');
  }

  if (args.decision === 'reject') {
    const { data, error } = await args.admin
      .from('property_document_requests')
      .update({ status: 'rejected' })
      .eq('id', args.request.id)
      .eq('account_id', args.request.account_id)
      .eq('property_id', args.request.property_id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('This request has already been processed');
    return { shareLink: null, delivered: false };
  }

  const property = await loadProperty(args.admin, args.request);
  if (!property) throw new Error('Property not found');

  const shareToken = (
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '')
  ).substring(0, 48);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const shareLink = `${appBaseUrl()}/docs/${shareToken}`;

  const { data, error } = await args.admin
    .from('property_document_requests')
    .update({
      status: 'approved',
      share_token: shareToken,
      share_token_expires_at: expiresAt,
      access_password: args.accessPassword || null,
    })
    .eq('id', args.request.id)
    .eq('account_id', args.request.account_id)
    .eq('property_id', args.request.property_id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This request has already been processed');

  const phone = normalizePhoneWithCountryCode(args.request.requester_phone);
  if (!phone) return { shareLink, delivered: false };

  const hasDocuments =
    Array.isArray(property.documents) &&
    property.documents.some((document) => {
      if (typeof document === 'string') return document.trim().length > 0;
      if (!document || typeof document !== 'object') return false;
      return Boolean((document as { url?: string }).url?.trim());
    });
  const text = hasDocuments
    ? args.accessPassword
      ? `Hi ${args.request.requester_name},\n\nYour request for the documents of *${property.title}* has been approved. Use password *${args.accessPassword}* to open them.\n\n📂 ${shareLink}\n\n_This link expires in 48 hours._`
      : `Hi ${args.request.requester_name},\n\nYour request for property documents has been approved.\n\n📋 *Property*: ${property.title}${property.property_code ? ` (${property.property_code})` : ''}\n📂 *Open documents*: ${shareLink}\n\n_This link expires in 48 hours._`
    : `Hi ${args.request.requester_name},\n\nYour document request for *${property.title}* was approved, but the documents are still being prepared. Our agent will share them shortly.`;

  const sent = await sendWhatsAppMessageAndPersist({
    accountId: args.request.account_id,
    userId: args.actorUserId,
    toPhone: phone,
    kind: 'text',
    senderType: 'agent',
    text,
  });
  if (sent.success) {
    await args.admin
      .from('property_document_requests')
      .update({ share_sent_at: new Date().toISOString() })
      .eq('id', args.request.id)
      .eq('account_id', args.request.account_id);
  }
  return { shareLink, delivered: sent.success };
}

export async function notifyDocumentRequestOwner(
  admin: SupabaseClient,
  request: DocumentRequestRow
): Promise<void> {
  const property = await loadProperty(admin, request);
  if (!property) return;
  const targetUserId = await resolveOwnerUserId(admin, request);
  if (!targetUserId) return;

  const propertyLine = `${property.title}${property.property_code ? ` (${property.property_code})` : ''}`;
  const reviewLink = `/inventory?propertyId=${property.property_code || property.id}`;
  const channels = await resolveChannels(
    request.account_id,
    'document_request'
  );

  await createNotification({
    accountId: request.account_id,
    userId: targetUserId,
    type: 'document_request',
    title: '📄 Document access requested',
    body: `${propertyLine} — ${request.requester_name} · ${request.requester_phone}`,
    entityType: 'property',
    entityId: property.id,
    link: reviewLink,
    channels: { inApp: channels.inApp, push: channels.push, whatsapp: false },
  });
  if (!channels.whatsapp) return;

  const agent = await resolveOwnerWhatsAppContact(
    admin,
    request.account_id,
    targetUserId
  );
  if (!agent) return;

  const body =
    `📄 *New Document Access Request*\n` +
    `Property: ${propertyLine}\n` +
    `From: ${request.requester_name} · ${request.requester_phone}\n\n` +
    `Approve to send a secure 48-hour document link, or reject to close the request. ` +
    `Review in ConvoReal: ${appBaseUrl()}${reviewLink}`;
  const destination = agent.contactId
    ? { contactId: agent.contactId }
    : { toPhone: agent.phone };
  const interactive = await sendWhatsAppMessageAndPersist({
    accountId: request.account_id,
    userId: targetUserId,
    ...destination,
    kind: 'interactive',
    senderType: 'bot',
    interactiveType: 'buttons',
    interactiveBody: body,
    interactiveButtons: [
      { id: `${DOCUMENT_APPROVE_PREFIX}${request.id}`, title: '✅ Approve' },
      { id: `${DOCUMENT_REJECT_PREFIX}${request.id}`, title: '❌ Reject' },
    ],
  });
  if (interactive.success || !isReengagementError(interactive.error)) return;

  const { template, language, fellBack } =
    await loadTemplateForContact<MessageTemplate>(admin, {
      accountId: request.account_id,
      contactId: agent.contactId,
      names: [LOCATION_OWNER_DECISION_TEMPLATE_NAME],
    });
  if (fellBack) {
    warnLanguageFallback(
      'document-owner-decision',
      request.account_id,
      language,
      template
    );
  }
  if (!template || (template.status ?? '').toUpperCase() !== 'APPROVED') return;

  const params = truncateParametersToBudget(template.body_text, [
    'Document access',
    propertyLine,
    `${request.requester_name} · ${request.requester_phone}`,
    'the property documents through a secure 48-hour link',
  ]);
  await sendWhatsAppMessageAndPersist({
    accountId: request.account_id,
    userId: targetUserId,
    ...destination,
    kind: 'template',
    senderType: 'bot',
    templateName: template.name,
    templateLanguage: template.language || 'en_US',
    templateParams: params,
    messageParams: {
      body: params,
      buttonParams: {
        0: `${DOCUMENT_APPROVE_PREFIX}${request.id}`,
        1: `${DOCUMENT_REJECT_PREFIX}${request.id}`,
      },
    },
    templateRow: template,
    text: renderTemplate(template.body_text, params),
  });
}

export function parseDocumentDecisionReply(
  replyId: string
): { requestId: string; decision: 'approve' | 'reject' } | null {
  if (replyId.startsWith(DOCUMENT_APPROVE_PREFIX)) {
    return {
      requestId: replyId.slice(DOCUMENT_APPROVE_PREFIX.length),
      decision: 'approve',
    };
  }
  if (replyId.startsWith(DOCUMENT_REJECT_PREFIX)) {
    return {
      requestId: replyId.slice(DOCUMENT_REJECT_PREFIX.length),
      decision: 'reject',
    };
  }
  return null;
}

export async function handleDocumentDecisionReply(args: {
  admin: SupabaseClient;
  accountId: string;
  replyId: string;
  senderPhone: string;
}): Promise<boolean> {
  const parsed = parseDocumentDecisionReply(args.replyId);
  if (!parsed) return false;
  const { data } = await args.admin
    .from('property_document_requests')
    .select('*')
    .eq('id', parsed.requestId)
    .eq('account_id', args.accountId)
    .maybeSingle();
  const request = data as DocumentRequestRow | null;
  if (!request || request.status !== 'pending') return true;

  const targetUserId = await resolveOwnerUserId(args.admin, request);
  if (!targetUserId) return true;
  const agent = await resolveOwnerWhatsAppContact(
    args.admin,
    args.accountId,
    targetUserId
  );
  if (!agent || !phonesMatch(agent.phone, args.senderPhone)) return true;

  try {
    const result = await decideDocumentRequest({
      admin: args.admin,
      request,
      decision: parsed.decision,
      actorUserId: targetUserId,
    });
    const property = await loadProperty(args.admin, request);
    const title = property?.title || 'the property';
    const ack =
      parsed.decision === 'reject'
        ? `👍 Noted — the document request for *${title}* was rejected.`
        : result.delivered
          ? `✅ Approved — ConvoReal sent the secure document link for *${title}* to the requester.`
          : `✅ Approved — but the document message for *${title}* could not be delivered. Open the request in ConvoReal to follow up.`;
    await sendWhatsAppMessageAndPersist({
      accountId: request.account_id,
      userId: targetUserId,
      ...(agent.contactId
        ? { contactId: agent.contactId }
        : { toPhone: agent.phone }),
      kind: 'text',
      senderType: 'bot',
      text: ack,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('already been processed')
    )
      return true;
    throw error;
  }
  return true;
}
