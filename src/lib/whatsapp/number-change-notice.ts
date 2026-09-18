import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_LANGUAGE, type LanguageCode } from '@/lib/languages';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import type {
  DispatcherResult,
  SendWhatsAppAndPersistArgs,
} from '@/lib/whatsapp/meta-api-dispatcher';
import {
  buildNumberChangeParams,
  NUMBER_CHANGE_TEMPLATE_NAME,
  NUMBER_CHANGE_TEMPLATE_NAMES,
  renderNumberChangeNotice,
} from '@/lib/whatsapp/number-change-template';
import {
  loadTemplateForContact,
  resolveLanguage,
  warnLanguageFallback,
} from '@/lib/whatsapp/template-language';
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder';

export const NUMBER_CHANGE_NOTICE_DAYS = 7;
export const RECENT_CONTACT_DAYS = 7;
export const MAX_RECENT_CONTACT_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type NoticeSender = (
  args: SendWhatsAppAndPersistArgs
) => Promise<DispatcherResult>;

export interface NumberChangeConfigLike {
  phone_number_id: string | null;
  integration_type?: string | null;
  previous_display_phone_number?: string | null;
  number_changed_at?: string | null;
}

export interface NumberChangeWindow {
  active: boolean;
  phoneNumberId: string | null;
  previousNumber: string | null;
  changedAt: string | null;
  expiresAt: string | null;
}

export function numberChangeWindow(
  config: NumberChangeConfigLike | null,
  now: number = Date.now()
): NumberChangeWindow {
  const inactive: NumberChangeWindow = {
    active: false,
    phoneNumberId: config?.phone_number_id ?? null,
    previousNumber: config?.previous_display_phone_number ?? null,
    changedAt: config?.number_changed_at ?? null,
    expiresAt: null,
  };
  if (!config) return inactive;
  if ((config.integration_type || 'official_api') !== 'official_api')
    return inactive;
  if (!config.phone_number_id || !config.previous_display_phone_number)
    return inactive;
  if (!config.number_changed_at) return inactive;
  const changedAt = new Date(config.number_changed_at).getTime();
  if (Number.isNaN(changedAt)) return inactive;
  const expiresAt = changedAt + NUMBER_CHANGE_NOTICE_DAYS * DAY_MS;
  return {
    active: now >= changedAt && now < expiresAt,
    phoneNumberId: config.phone_number_id,
    previousNumber: config.previous_display_phone_number,
    changedAt: config.number_changed_at,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function clampRecentDays(value: unknown): number {
  const days = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(days)) return RECENT_CONTACT_DAYS;
  return Math.min(MAX_RECENT_CONTACT_DAYS, Math.max(1, Math.floor(days)));
}

export type NoticeOutcome =
  | {
      status: 'sent';
      channel: 'template' | 'freeform';
      messageId: string | null;
    }
  | { status: 'already' }
  | { status: 'skipped'; reason: 'template_not_approved' }
  | { status: 'failed'; reason: string };

interface NoticeTemplateRow {
  name: string;
  language?: string | null;
  status?: string | null;
  body_text: string;
}

async function isConversationWindowOpen(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<boolean> {
  const { data: conversation } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();
  if (!conversation) return false;
  const { data: lastInbound } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return isWithinCustomerWindow(lastInbound?.created_at ?? null);
}

export async function sendNumberChangeNotice(
  db: SupabaseClient,
  args: {
    accountId: string;
    contactId: string;
    phoneNumberId: string;
    previousNumber: string;
    trigger: 'manual' | 'precursor';
    send: NoticeSender;
    businessName?: string | null;
    contactName?: string | null;
    contactLanguage?: string | null;
    accountLanguage?: LanguageCode;
    allowDeadContact?: boolean;
    allowChainOnly?: boolean;
  }
): Promise<NoticeOutcome> {
  const { data: claim, error: claimError } = await db
    .from('whatsapp_number_change_notices')
    .insert({
      account_id: args.accountId,
      contact_id: args.contactId,
      phone_number_id: args.phoneNumberId,
      previous_display_phone_number: args.previousNumber,
      trigger: args.trigger,
      channel: 'pending',
    })
    .select('id')
    .maybeSingle();
  if (claimError) {
    if (claimError.code === '23505') return { status: 'already' };
    return { status: 'failed', reason: claimError.message };
  }
  if (!claim)
    return { status: 'failed', reason: 'Could not record the notice.' };

  const releaseClaim = async () => {
    await db
      .from('whatsapp_number_change_notices')
      .delete()
      .eq('id', claim.id)
      .eq('account_id', args.accountId);
  };

  try {
    let businessName = args.businessName ?? null;
    if (!businessName) {
      const { data: account } = await db
        .from('accounts')
        .select('name')
        .eq('id', args.accountId)
        .maybeSingle();
      businessName = (account as { name?: string | null } | null)?.name ?? null;
    }

    let contactName = args.contactName;
    let contactLanguage = args.contactLanguage;
    if (contactName === undefined || contactLanguage === undefined) {
      const { data: contact } = await db
        .from('contacts')
        .select('name, preferred_language')
        .eq('id', args.contactId)
        .eq('account_id', args.accountId)
        .maybeSingle();
      contactName = contactName ?? (contact?.name as string | null) ?? null;
      contactLanguage =
        contactLanguage ??
        (contact?.preferred_language as string | null) ??
        null;
    }

    const language = resolveLanguage(
      contactLanguage,
      args.accountLanguage ?? DEFAULT_LANGUAGE
    );
    const params = buildNumberChangeParams(
      contactName,
      businessName ?? '',
      args.previousNumber
    );
    const common = {
      accountId: args.accountId,
      contactId: args.contactId,
      senderType: 'bot' as const,
      numberChangeNotice: true,
      allowDeadContact: args.allowDeadContact,
      allowChainOnly: args.allowChainOnly,
    };

    if (await isConversationWindowOpen(db, args.accountId, args.contactId)) {
      const result = await args.send({
        ...common,
        kind: 'text',
        text: renderNumberChangeNotice(language, params),
      });
      if (!result.success) {
        await releaseClaim();
        return { status: 'failed', reason: result.error ?? 'Send failed' };
      }
      await markSent(
        db,
        claim.id,
        args.accountId,
        'freeform',
        result.messageId ?? null
      );
      return {
        status: 'sent',
        channel: 'freeform',
        messageId: result.messageId ?? null,
      };
    }

    const { template, fellBack } =
      await loadTemplateForContact<NoticeTemplateRow>(db, {
        accountId: args.accountId,
        contactId: args.contactId,
        language,
        names: NUMBER_CHANGE_TEMPLATE_NAMES,
      });
    if (!template || template.status !== 'APPROVED') {
      await releaseClaim();
      return { status: 'skipped', reason: 'template_not_approved' };
    }
    if (fellBack) {
      warnLanguageFallback(
        'number-change-notice',
        args.accountId,
        language,
        template
      );
    }

    const bodyParams = truncateParametersToBudget(template.body_text, [
      ...params,
    ]);
    const result = await args.send({
      ...common,
      kind: 'template',
      templateName: template.name,
      templateLanguage: template.language || 'en_US',
      templateParams: bodyParams,
      messageParams: { body: bodyParams },
      templateRow: template,
      text: template.body_text.replace(
        /\{\{(\d+)\}\}/g,
        (match, index: string) => bodyParams[Number(index) - 1] ?? match
      ),
    });
    if (!result.success) {
      await releaseClaim();
      return { status: 'failed', reason: result.error ?? 'Send failed' };
    }
    await markSent(
      db,
      claim.id,
      args.accountId,
      'template',
      result.messageId ?? null
    );
    return {
      status: 'sent',
      channel: 'template',
      messageId: result.messageId ?? null,
    };
  } catch (err) {
    await releaseClaim();
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

async function markSent(
  db: SupabaseClient,
  claimId: string,
  accountId: string,
  channel: 'template' | 'freeform',
  messageId: string | null
): Promise<void> {
  await db
    .from('whatsapp_number_change_notices')
    .update({
      channel,
      message_id: messageId,
      sent_at: new Date().toISOString(),
    })
    .eq('id', claimId)
    .eq('account_id', accountId)
    .select('id');
}

export interface NumberChangeAudienceRow {
  contact_id: string;
  name: string | null;
  preferred_language: string | null;
  last_message_at: string | null;
}

export async function loadNumberChangeAudience(
  db: SupabaseClient,
  args: { accountId: string; phoneNumberId: string; days: number; now?: number }
): Promise<NumberChangeAudienceRow[]> {
  const since = new Date(
    (args.now ?? Date.now()) - args.days * DAY_MS
  ).toISOString();
  const { data, error } = await db.rpc('whatsapp_number_change_audience', {
    p_account_id: args.accountId,
    p_since: since,
    p_phone_number_id: args.phoneNumberId,
  });
  if (error) throw error;
  return (data ?? []) as NumberChangeAudienceRow[];
}

export interface NotifyRecentContactsResult {
  audience: number;
  sent: number;
  viaTemplate: number;
  viaFreeform: number;
  skippedNoTemplate: number;
  failed: number;
}

export async function notifyRecentContacts(args: {
  userDb: SupabaseClient;
  adminDb: SupabaseClient;
  accountId: string;
  window: NumberChangeWindow;
  days: number;
  businessName: string;
  accountLanguage: LanguageCode;
  send: NoticeSender;
}): Promise<NotifyRecentContactsResult> {
  const result: NotifyRecentContactsResult = {
    audience: 0,
    sent: 0,
    viaTemplate: 0,
    viaFreeform: 0,
    skippedNoTemplate: 0,
    failed: 0,
  };
  if (
    !args.window.active ||
    !args.window.phoneNumberId ||
    !args.window.previousNumber
  ) {
    return result;
  }
  const audience = await loadNumberChangeAudience(args.userDb, {
    accountId: args.accountId,
    phoneNumberId: args.window.phoneNumberId,
    days: args.days,
  });
  result.audience = audience.length;

  for (const row of audience) {
    const outcome = await sendNumberChangeNotice(args.adminDb, {
      accountId: args.accountId,
      contactId: row.contact_id,
      phoneNumberId: args.window.phoneNumberId,
      previousNumber: args.window.previousNumber,
      trigger: 'manual',
      send: args.send,
      businessName: args.businessName,
      contactName: row.name,
      contactLanguage: row.preferred_language,
      accountLanguage: args.accountLanguage,
    });
    if (outcome.status === 'sent') {
      result.sent++;
      if (outcome.channel === 'template') result.viaTemplate++;
      else result.viaFreeform++;
    } else if (outcome.status === 'skipped') {
      result.skippedNoTemplate++;
      break;
    } else if (outcome.status === 'failed') {
      result.failed++;
    }
  }
  return result;
}

export async function maybeSendNumberChangePrecursor(
  db: SupabaseClient,
  args: {
    accountId: string;
    contactId: string;
    config: NumberChangeConfigLike;
    send: NoticeSender;
    allowDeadContact?: boolean;
    allowChainOnly?: boolean;
  }
): Promise<void> {
  const window = numberChangeWindow(args.config);
  if (!window.active || !window.phoneNumberId || !window.previousNumber) return;
  try {
    const outcome = await sendNumberChangeNotice(db, {
      accountId: args.accountId,
      contactId: args.contactId,
      phoneNumberId: window.phoneNumberId,
      previousNumber: window.previousNumber,
      trigger: 'precursor',
      send: args.send,
      allowDeadContact: args.allowDeadContact,
      allowChainOnly: args.allowChainOnly,
    });
    if (outcome.status === 'failed') {
      console.warn(
        `[number-change-notice] precursor to contact ${args.contactId} failed: ${outcome.reason}`
      );
    }
  } catch (err) {
    console.warn(
      '[number-change-notice] precursor failed:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

export { NUMBER_CHANGE_TEMPLATE_NAME };
