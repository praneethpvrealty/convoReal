// ============================================================
// Deal status notices — the drain for `deal_status_notifications`.
//
// Database triggers (migration 20261014023548) close a buyer's open
// follow-up todos when their journey branch drops, their deal is won or
// lost, or the property leaves the market, and queue one neutral notice
// per counterpart. Postgres cannot send WhatsApp, so this module is the
// half that does: it sweeps stale todos the triggers predate, then
// sends each pending notice session-first and, for a buyer whose
// listing is gone, through the approved enquiry status template.
//
// What never goes out: the internal reason (it stays on the row), a
// notice to the property owner, and a template to a stakeholder or to
// the buyer who won — the template's copy says the listing is no
// longer available, which is not their news.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageTemplate, Property } from '@/types';
import { isSessionOpen, sendDenNotification } from '@/lib/den/notify';
import { resolveQuietPeriod } from '@/lib/notifications/quiet-hours';
import { accountBrandName } from '@/lib/showcase/account-showcase-url';
import {
  ENQUIRY_NOTICE_TEMPLATE_NAMES,
  buildEnquiryNoticeTextParams,
  describeEnquiredProperty,
  enquiryNoticeParamCount,
} from '@/lib/whatsapp/enquiry-notice-template';
import {
  ENQUIRY_FOLLOWUP_TEMPLATE_NAMES,
  buildEnquiryFollowupParams,
  enquiryFollowupParamCount,
} from '@/lib/whatsapp/enquiry-followup-template';
import { pickApprovedTemplate } from '@/lib/whatsapp/pick-approved-template';

export const DEAL_STATUS_NOTICE_TEMPLATE_NAMES = [
  ...ENQUIRY_NOTICE_TEMPLATE_NAMES,
  ...ENQUIRY_FOLLOWUP_TEMPLATE_NAMES,
];

export const MAX_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 60 * 60 * 1000;
export const SESSION_WAIT_MS = 48 * 60 * 60 * 1000;

export type DealStatusNoticeEvent =
  'dropped' | 'lost' | 'won' | 'property_sold';

export interface DealStatusNoticeRow {
  id: string;
  account_id: string;
  contact_id: string | null;
  recipient_name: string | null;
  recipient_role: string | null;
  property_id: string | null;
  event: DealStatusNoticeEvent;
  message_text: string;
  attempt_count: number;
  created_at: string;
}

export interface DealStatusNoticeSummary {
  closedTodos: number;
  queued: number;
  sent: number;
  deferred: number;
  skipped: number;
  failed: number;
}

export type NoticeDisposition =
  | { kind: 'text' }
  | { kind: 'template' }
  | { kind: 'wait' }
  | { kind: 'skip'; reason: string };

export function pickDealStatusNoticeTemplate<
  T extends { name: string; status?: string | null; category?: string | null },
>(rows: T[]): T | null {
  return pickApprovedTemplate(rows, DEAL_STATUS_NOTICE_TEMPLATE_NAMES);
}

/** Body params for whichever approved name the picker lands on: the
 *  listing notice carries name, brand and property (its legacy name
 *  name and property); the plain status notice carries name and brand
 *  (its legacy name only the name). */
export function dealStatusNoticeParams(
  templateName: string,
  contactName: string | null | undefined,
  propertyDescription: string,
  brandName: string | null
): string[] {
  if (ENQUIRY_NOTICE_TEMPLATE_NAMES.includes(templateName)) {
    const [name, brand, property] = buildEnquiryNoticeTextParams(
      contactName,
      propertyDescription,
      brandName
    );
    return enquiryNoticeParamCount(templateName) === 3
      ? [name, brand, property]
      : [name, property];
  }
  const [name, brand] = buildEnquiryFollowupParams(contactName, brandName);
  return enquiryFollowupParamCount(templateName) === 2 ? [name, brand] : [name];
}

export function noticeDisposition(
  row: Pick<DealStatusNoticeRow, 'event' | 'recipient_role' | 'created_at'>,
  sessionOpen: boolean,
  now: Date
): NoticeDisposition {
  if (sessionOpen) return { kind: 'text' };
  const listingGone =
    row.recipient_role === 'buyer' &&
    (row.event === 'dropped' ||
      row.event === 'lost' ||
      row.event === 'property_sold');
  if (listingGone) return { kind: 'template' };
  const age = now.getTime() - new Date(row.created_at).getTime();
  if (age >= SESSION_WAIT_MS) {
    return {
      kind: 'skip',
      reason:
        row.event === 'won'
          ? 'No open session within 48h; the status template does not fit a concluded transaction'
          : 'No open session within 48h; the status template is written for the buyer',
    };
  }
  return { kind: 'wait' };
}

async function updateNotice(
  db: SupabaseClient,
  row: DealStatusNoticeRow,
  update: Record<string, unknown>
): Promise<void> {
  const { error } = await db
    .from('deal_status_notifications')
    .update(update)
    .eq('id', row.id)
    .eq('account_id', row.account_id);
  if (error)
    console.error('[deal-status-notices] queue update failed:', error.message);
}

async function skipNotice(
  db: SupabaseClient,
  row: DealStatusNoticeRow,
  reason: string
): Promise<void> {
  await updateNotice(db, row, {
    status: 'skipped',
    claimed_at: null,
    last_error: reason,
  });
}

async function releaseNotice(
  db: SupabaseClient,
  row: DealStatusNoticeRow
): Promise<void> {
  await updateNotice(db, row, { claimed_at: null });
}

export async function sweepStaleDealTodos(
  db: SupabaseClient,
  accountId: string
): Promise<number> {
  const { data, error } = await db.rpc('auto_close_stale_deal_todos', {
    p_account_id: accountId,
  });
  if (error) {
    console.error('[deal-status-notices] todo sweep failed:', error.message);
    return 0;
  }
  return typeof data === 'number' ? data : 0;
}

export async function drainDealStatusNotices(
  db: SupabaseClient,
  accountId: string,
  options: { now?: Date; limit?: number } = {}
): Promise<DealStatusNoticeSummary> {
  const now = options.now ?? new Date();
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const summary: DealStatusNoticeSummary = {
    closedTodos: 0,
    queued: 0,
    sent: 0,
    deferred: 0,
    skipped: 0,
    failed: 0,
  };

  summary.closedTodos = await sweepStaleDealTodos(db, accountId);

  const retryBefore = new Date(now.getTime() - RETRY_DELAY_MS).toISOString();
  const claimable = `claimed_at.is.null,claimed_at.lt.${retryBefore}`;
  const { data: rows, error } = await db
    .from('deal_status_notifications')
    .select(
      'id, account_id, contact_id, recipient_name, recipient_role, property_id, event, message_text, attempt_count, created_at'
    )
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .or(claimable)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('[deal-status-notices] queue fetch failed:', error.message);
    return summary;
  }
  summary.queued = rows?.length ?? 0;
  if (!rows?.length) return summary;

  let brandName: string | null | undefined;

  for (const raw of rows) {
    const row = raw as DealStatusNoticeRow;
    const { data: claim } = await db
      .from('deal_status_notifications')
      .update({ claimed_at: now.toISOString() })
      .eq('id', row.id)
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .or(claimable)
      .select('id')
      .maybeSingle();
    if (!claim) continue;

    if (!row.contact_id) {
      await skipNotice(db, row, 'No contact record for recipient');
      summary.skipped++;
      continue;
    }

    const [{ data: contact }, { data: property }] = await Promise.all([
      db
        .from('contacts')
        .select('id, name, phone, is_archived, is_merged')
        .eq('id', row.contact_id)
        .eq('account_id', accountId)
        .maybeSingle(),
      row.property_id
        ? db
            .from('properties')
            .select('*')
            .eq('id', row.property_id)
            .eq('account_id', accountId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const recipient = contact as {
      id: string;
      name: string | null;
      phone: string | null;
      is_archived?: boolean | null;
      is_merged?: boolean | null;
    } | null;
    const listing = property as Property | null;

    if (!recipient || !recipient.phone) {
      await skipNotice(db, row, 'Recipient has no WhatsApp number');
      summary.skipped++;
      continue;
    }
    if (recipient.is_archived || recipient.is_merged) {
      await skipNotice(db, row, 'Recipient is archived');
      summary.skipped++;
      continue;
    }
    if (
      listing?.owner_contact_id &&
      listing.owner_contact_id === recipient.id
    ) {
      await skipNotice(db, row, 'Recipient owns the property');
      summary.skipped++;
      continue;
    }

    const quiet = await resolveQuietPeriod(accountId, 'client', now);
    if (quiet.isQuiet) {
      await releaseNotice(db, row);
      summary.deferred++;
      continue;
    }

    const sessionOpen = await isSessionOpen(db, accountId, recipient.id);
    const disposition = noticeDisposition(row, sessionOpen, now);
    if (disposition.kind === 'skip') {
      await skipNotice(db, row, disposition.reason);
      summary.skipped++;
      continue;
    }
    if (disposition.kind === 'wait') {
      await releaseNotice(db, row);
      summary.deferred++;
      continue;
    }

    if (disposition.kind === 'template' && brandName === undefined) {
      brandName = await accountBrandName(db, accountId);
    }
    const propertyDescription = listing
      ? describeEnquiredProperty(listing)
      : 'the property you enquired about';
    const delivered = await sendDenNotification(db, {
      accountId,
      contactId: recipient.id,
      text: row.message_text,
      ...(disposition.kind === 'template'
        ? {
            templateName: DEAL_STATUS_NOTICE_TEMPLATE_NAMES,
            pickTemplate: (templates: MessageTemplate[]) =>
              pickDealStatusNoticeTemplate(templates),
            buildParams: (template: MessageTemplate) =>
              dealStatusNoticeParams(
                template.name,
                recipient.name ?? row.recipient_name,
                propertyDescription,
                brandName ?? null
              ),
          }
        : {}),
    });

    if (delivered) {
      await updateNotice(db, row, {
        status: 'sent',
        claimed_at: null,
        sent_at: new Date().toISOString(),
        last_error: null,
      });
      summary.sent++;
      continue;
    }

    const attemptCount = row.attempt_count + 1;
    await updateNotice(db, row, {
      status: attemptCount >= MAX_ATTEMPTS ? 'failed' : 'pending',
      attempt_count: attemptCount,
      last_error: 'WhatsApp channel unavailable',
    });
    summary.failed++;
  }

  return summary;
}

export async function drainDealStatusNoticesForConnectedAccounts(
  db: SupabaseClient,
  now: Date = new Date()
): Promise<DealStatusNoticeSummary> {
  const total: DealStatusNoticeSummary = {
    closedTodos: 0,
    queued: 0,
    sent: 0,
    deferred: 0,
    skipped: 0,
    failed: 0,
  };
  const { data: configs, error } = await db
    .from('whatsapp_config')
    .select('account_id')
    .eq('status', 'connected');
  if (error) {
    console.error(
      '[deal-status-notices] account lookup failed:',
      error.message
    );
    return total;
  }

  const accountIds = [
    ...new Set((configs ?? []).map((config) => config.account_id as string)),
  ];
  for (const accountId of accountIds) {
    try {
      const result = await drainDealStatusNotices(db, accountId, { now });
      total.closedTodos += result.closedTodos;
      total.queued += result.queued;
      total.sent += result.sent;
      total.deferred += result.deferred;
      total.skipped += result.skipped;
      total.failed += result.failed;
    } catch (err) {
      total.failed++;
      console.error(
        '[deal-status-notices] account drain failed:',
        accountId,
        err
      );
    }
  }
  return total;
}
