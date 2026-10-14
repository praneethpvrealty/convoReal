// ============================================================
// Deal status notices — the drain for `deal_status_notifications`.
//
// Database triggers (migration 20261014023548) close a buyer's open
// follow-up todos when their journey branch drops, their deal is won or
// lost, or the property leaves the market, and queue one neutral notice
// per counterpart. Postgres cannot send WhatsApp, so this module is the
// half that does: it sweeps stale todos the triggers predate on every
// account, then for each account with a connected sender sends each
// pending notice session-first and, for a buyer whose
// listing is gone, through the approved enquiry status template.
//
// What never goes out: the internal reason (it stays on the row), a
// notice to the property owner or to a contact who closed their enquiry
// on the listing, a 'property_sold' row (the listing status sender in
// src/lib/whatsapp/sold-notification.ts already owns that update, and
// the held migration stops the trigger queueing it), and a template to
// a stakeholder (told apart from the primary buyer by the deal or
// journey branch the row belongs to, never by role), to the buyer who
// won, or on a deal that names no listing — the template's copy says
// the listing is no longer available, which is not their news.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageTemplate, Property } from '@/types';
import {
  isSessionOpenResult,
  sendDenNotificationResult,
} from '@/lib/den/notify';
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
export const SEND_IN_PROGRESS = 'Send in progress';
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
  deal_id: string | null;
  journey_item_id: string | null;
  event: DealStatusNoticeEvent;
  message_text: string;
  attempt_count: number;
  claimed_at: string | null;
  last_error: string | null;
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
  row: Pick<DealStatusNoticeRow, 'event' | 'property_id' | 'created_at'>,
  recipient: { primaryBuyer: boolean; sessionOpen: boolean },
  now: Date
): NoticeDisposition {
  if (recipient.sessionOpen) return { kind: 'text' };
  const listingGone =
    recipient.primaryBuyer &&
    !!row.property_id &&
    (row.event === 'dropped' || row.event === 'lost');
  if (listingGone) return { kind: 'template' };
  const age = now.getTime() - new Date(row.created_at).getTime();
  if (age >= SESSION_WAIT_MS) {
    return {
      kind: 'skip',
      reason:
        row.event === 'won'
          ? 'No open session within 48h; the status template does not fit a concluded transaction'
          : row.property_id
            ? 'No open session within 48h; the status template is written for the buyer'
            : 'No open session within 48h; the status template names a listing and this deal has none',
    };
  }
  return { kind: 'wait' };
}

/** The primary buyer is the contact the deal or journey branch belongs
 *  to; a buyer-side stakeholder can carry the role 'buyer' too (a joint
 *  buyer), so the role alone cannot tell them apart, and a row whose
 *  source is gone is treated as a stakeholder's. The same read says
 *  whether the outcome still holds: a deal reopened or re-closed the
 *  other way, or a journey branch revived, makes the notice stale. A
 *  dropped row answers to its journey branch, never to a deal the
 *  trigger may have attached by contact and property. */
async function resolveSource(
  db: SupabaseClient,
  accountId: string,
  row: DealStatusNoticeRow
): Promise<{ primaryBuyer: boolean; stale: boolean; error: string | null }> {
  const journeyFirst = row.event === 'dropped' && !!row.journey_item_id;
  if (row.deal_id && !journeyFirst) {
    const { data, error } = await db
      .from('deals')
      .select('contact_id, status')
      .eq('id', row.deal_id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error)
      return { primaryBuyer: false, stale: false, error: error.message };
    const deal = data as { contact_id: string | null; status: string } | null;
    if (!deal) return { primaryBuyer: false, stale: false, error: null };
    const expected = row.event === 'won' ? 'won' : 'lost';
    return {
      primaryBuyer: !!deal.contact_id && deal.contact_id === row.contact_id,
      stale: deal.status !== expected,
      error: null,
    };
  }
  if (row.journey_item_id) {
    const { data, error } = await db
      .from('journey_items')
      .select('contact_id, status')
      .eq('id', row.journey_item_id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error)
      return { primaryBuyer: false, stale: false, error: error.message };
    const item = data as { contact_id: string | null; status: string } | null;
    if (!item) return { primaryBuyer: false, stale: false, error: null };
    return {
      primaryBuyer: !!item.contact_id && item.contact_id === row.contact_id,
      stale: row.event !== 'won' && item.status !== 'dropped',
      error: null,
    };
  }
  return { primaryBuyer: false, stale: false, error: null };
}

/** A notice that reached WhatsApp but whose row could not be marked
 *  sent would go out again an hour later; the conversation keeps the
 *  message, so it is the record of truth before any resend. */
async function alreadyDelivered(
  db: SupabaseClient,
  accountId: string,
  row: DealStatusNoticeRow,
  contactId: string
): Promise<{ delivered: boolean; error: string | null }> {
  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();
  if (conversationError) {
    return { delivered: false, error: conversationError.message };
  }
  if (!conversation) return { delivered: false, error: null };
  const { data: message, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'bot')
    .eq('content_text', row.message_text)
    .neq('status', 'failed')
    .gte('created_at', row.created_at)
    .limit(1)
    .maybeSingle();
  if (error) return { delivered: false, error: error.message };
  return { delivered: !!message, error: null };
}

/** A terminal update is retried once. Two durable marks bracket a send:
 *  the claim stamps claimed_at before any lookup, and the send mark
 *  (attempt counted, last_error = SEND_IN_PROGRESS) is written just
 *  before the message goes out, onto the still-pending row this run
 *  claimed, or the send does not happen. A row found
 *  still claimed an hour later with the send mark is one whose outcome
 *  was never recorded and is retired rather than resent; one without the
 *  mark never reached a send and is simply processed again, which is
 *  also how a held row (quiet hours, no session yet) comes back an hour
 *  later. The sender is handed the session answer the drain already
 *  has, so nothing it reads between the mark and the send can fail. A
 *  template the contact's Marketing pause refused never reached Meta:
 *  the attempt is handed back and the row held under its claim, so the
 *  hourly look sends it as text once a reply opens a session. Every
 *  recorded outcome clears claimed_at. */
async function updateNotice(
  db: SupabaseClient,
  row: DealStatusNoticeRow,
  update: Record<string, unknown>
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await db
      .from('deal_status_notifications')
      .update(update)
      .eq('id', row.id)
      .eq('account_id', row.account_id);
    if (!error) return true;
    console.error(
      '[deal-status-notices] queue update failed:',
      row.id,
      error.message
    );
  }
  return false;
}

/** The send mark lands only on the row this run claimed and that is
 *  still pending: a trigger that retired the row between the claim and
 *  the mark (the deal reopened, the branch revived) leaves nothing to
 *  mark, and the row stays as the trigger left it. */
async function markSend(
  db: SupabaseClient,
  row: DealStatusNoticeRow,
  now: Date
): Promise<{ marked: boolean; error: string | null }> {
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await db
      .from('deal_status_notifications')
      .update({
        attempt_count: row.attempt_count + 1,
        last_error: SEND_IN_PROGRESS,
      })
      .eq('id', row.id)
      .eq('account_id', row.account_id)
      .eq('status', 'pending')
      .eq('claimed_at', now.toISOString())
      .select('id')
      .maybeSingle();
    if (!error) return { marked: !!data, error: null };
    lastError = error.message;
  }
  return { marked: false, error: lastError };
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

/** A row waiting on a session or on quiet hours keeps this run's claim
 *  and is looked at again an hour later, when the claim ages into the
 *  claimable window; released at once it would sit at the head of every
 *  batch and crowd newer rows out of it. */
async function holdNotice(
  db: SupabaseClient,
  row: DealStatusNoticeRow,
  reason: string
): Promise<void> {
  await updateNotice(db, row, { last_error: reason });
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

  const retryBefore = new Date(now.getTime() - RETRY_DELAY_MS).toISOString();
  const claimable = `and(claimed_at.is.null,attempt_count.eq.0),and(claimed_at.is.null,updated_at.lt.${retryBefore}),claimed_at.lt.${retryBefore}`;
  const { data: rows, error } = await db
    .from('deal_status_notifications')
    .select(
      'id, account_id, contact_id, recipient_name, recipient_role, property_id, deal_id, journey_item_id, event, message_text, attempt_count, claimed_at, last_error, created_at'
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

    if (row.claimed_at && row.last_error === SEND_IN_PROGRESS) {
      const prior = row.contact_id
        ? await alreadyDelivered(db, accountId, row, row.contact_id)
        : { delivered: false, error: null };
      if (prior.error) {
        console.error(
          '[deal-status-notices] delivery lookup failed; retrying later:',
          row.id,
          prior.error
        );
        summary.failed++;
        continue;
      }
      if (prior.delivered) {
        const recorded = await updateNotice(db, row, {
          status: 'sent',
          claimed_at: null,
          sent_at: new Date().toISOString(),
          last_error: null,
        });
        if (recorded) summary.sent++;
        else summary.failed++;
        continue;
      }
      await updateNotice(db, row, {
        status: 'failed',
        claimed_at: null,
        last_error: 'Previous attempt did not record its outcome; not resent',
      });
      summary.failed++;
      continue;
    }

    if (row.event === 'property_sold') {
      await skipNotice(
        db,
        row,
        'Sold updates are sent by the listing status sender'
      );
      summary.skipped++;
      continue;
    }
    if (!row.contact_id) {
      await skipNotice(db, row, 'No contact record for recipient');
      summary.skipped++;
      continue;
    }

    const [contactLookup, propertyLookup] = await Promise.all([
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
        : Promise.resolve({ data: null, error: null }),
    ]);
    const lookupError = contactLookup.error ?? propertyLookup.error;
    if (lookupError) {
      console.error(
        '[deal-status-notices] recipient lookup failed; retrying later:',
        row.id,
        lookupError.message
      );
      await releaseNotice(db, row);
      summary.failed++;
      continue;
    }
    const { data: contact } = contactLookup;
    const { data: property } = propertyLookup;

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
    if (row.property_id) {
      const { data: rejected, error: rejectedError } = await db
        .from('listing_feedback')
        .select('id')
        .eq('account_id', accountId)
        .eq('property_id', row.property_id)
        .eq('contact_id', recipient.id)
        .eq('verdict', 'rejected')
        .limit(1)
        .maybeSingle();
      if (rejectedError) {
        console.error(
          '[deal-status-notices] enquiry closure lookup failed; retrying later:',
          row.id,
          rejectedError.message
        );
        await releaseNotice(db, row);
        summary.failed++;
        continue;
      }
      if (rejected) {
        await skipNotice(
          db,
          row,
          'Recipient closed their enquiry on this listing'
        );
        summary.skipped++;
        continue;
      }
    }

    const quiet = await resolveQuietPeriod(accountId, 'client', now);
    if (quiet.isQuiet) {
      await holdNotice(db, row, 'Held through client quiet hours');
      summary.deferred++;
      continue;
    }

    const {
      primaryBuyer,
      stale,
      error: sourceError,
    } = await resolveSource(db, accountId, row);
    if (sourceError) {
      console.error(
        '[deal-status-notices] deal lookup failed; retrying later:',
        row.id,
        sourceError
      );
      await releaseNotice(db, row);
      summary.failed++;
      continue;
    }
    if (stale) {
      await skipNotice(
        db,
        row,
        'Deal status changed before the notice was sent'
      );
      summary.skipped++;
      continue;
    }
    const session = await isSessionOpenResult(db, accountId, recipient.id);
    if (session.error) {
      console.error(
        '[deal-status-notices] session lookup failed; retrying later:',
        row.id,
        session.error
      );
      await releaseNotice(db, row);
      summary.failed++;
      continue;
    }
    const sessionOpen = session.open;
    const disposition = noticeDisposition(
      row,
      { primaryBuyer, sessionOpen },
      now
    );
    if (disposition.kind === 'skip') {
      await skipNotice(db, row, disposition.reason);
      summary.skipped++;
      continue;
    }
    if (disposition.kind === 'wait') {
      await holdNotice(db, row, 'Waiting for an open session');
      summary.deferred++;
      continue;
    }

    const prior = await alreadyDelivered(db, accountId, row, recipient.id);
    if (prior.error) {
      console.error(
        '[deal-status-notices] delivery lookup failed; retrying later:',
        row.id,
        prior.error
      );
      await releaseNotice(db, row);
      summary.failed++;
      continue;
    }
    if (prior.delivered) {
      const recorded = await updateNotice(db, row, {
        status: 'sent',
        claimed_at: null,
        sent_at: new Date().toISOString(),
        last_error: null,
      });
      if (recorded) summary.sent++;
      else summary.failed++;
      continue;
    }

    if (disposition.kind === 'template' && brandName === undefined) {
      brandName = await accountBrandName(db, accountId);
    }
    const propertyDescription = listing
      ? describeEnquiredProperty(listing)
      : 'the property you enquired about';
    const mark = await markSend(db, row, now);
    if (mark.error) {
      console.error(
        '[deal-status-notices] send mark failed; retrying later:',
        row.id,
        mark.error
      );
      await releaseNotice(db, row);
      summary.failed++;
      continue;
    }
    if (!mark.marked) {
      summary.skipped++;
      continue;
    }
    const delivery = await sendDenNotificationResult(db, {
      accountId,
      contactId: recipient.id,
      sessionOpen,
      text: row.message_text,
      ...(disposition.kind === 'template'
        ? {
            templateName: DEAL_STATUS_NOTICE_TEMPLATE_NAMES,
            preferUtility: true,
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

    if (delivery.sent) {
      const recorded = await updateNotice(db, row, {
        status: 'sent',
        claimed_at: null,
        sent_at: new Date().toISOString(),
        last_error: null,
      });
      if (!recorded) {
        console.error(
          '[deal-status-notices] notice sent but still pending; the conversation record stops a resend:',
          row.id
        );
        summary.failed++;
        continue;
      }
      summary.sent++;
      continue;
    }

    if (delivery.reachedMeta) {
      await updateNotice(db, row, {
        status: 'failed',
        claimed_at: null,
        last_error:
          'Meta accepted the message but its row was not persisted; not retried',
      });
      summary.failed++;
      continue;
    }

    if (delivery.retryAfter) {
      await updateNotice(db, row, {
        attempt_count: row.attempt_count,
        last_error: `Marketing paused for this contact until ${delivery.retryAfter}`,
      });
      summary.deferred++;
      continue;
    }

    const attemptCount = row.attempt_count + 1;
    await updateNotice(db, row, {
      status: attemptCount >= MAX_ATTEMPTS ? 'failed' : 'pending',
      claimed_at: null,
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
  const { data: accounts, error: accountsError } = await db
    .from('accounts')
    .select('id');
  if (accountsError) {
    console.error(
      '[deal-status-notices] account lookup failed:',
      accountsError.message
    );
    return total;
  }
  for (const account of accounts ?? []) {
    total.closedTodos += await sweepStaleDealTodos(db, account.id as string);
  }

  const { data: configs, error } = await db
    .from('whatsapp_config')
    .select('account_id')
    .eq('status', 'connected');
  if (error) {
    console.error('[deal-status-notices] sender lookup failed:', error.message);
    return total;
  }

  const accountIds = [
    ...new Set((configs ?? []).map((config) => config.account_id as string)),
  ];
  for (const accountId of accountIds) {
    try {
      const result = await drainDealStatusNotices(db, accountId, { now });
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
