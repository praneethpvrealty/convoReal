/**
 * Post-call follow-up dispatcher (docs/post-call-followup-plan.md §4).
 *
 * Every WhatsApp send a playbook decides on goes through here, and the
 * safety rules live here in one place: do-not-call, the 24-hour
 * window, the Utility gate on the opener template, dedupe against
 * redelivered webhooks, and skip reasons recorded rather than silent.
 *
 * The economics (§2): a phone call does not open Meta's window, so a
 * shut window means one Utility opener whose quick-reply tap — an
 * inbound message — opens it; the rich follow-up (the matched-listing
 * shortlist the rest of the product already sends) rides free-form
 * behind the tap. A `note` or `handoff` is never worth a template:
 * window-only, skipped visibly otherwise.
 *
 * Never throws from its entry points: a follow-up failure must not
 * break the voice webhook or the cron that shares it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import { canSendToEveryLead } from '@/lib/reengagement/template-gate';
import {
  narrowToLanguage,
  resolveSendLanguage,
} from '@/lib/whatsapp/template-language';
import {
  buildPostCallOpenerParams,
  pickPostCallOpenerTemplate,
  POST_CALL_OPENER_TEMPLATE_NAME,
} from '@/lib/whatsapp/post-call-template';
import { buildMatchesReply } from '@/lib/ai/buyer-qualification';
import { rankPropertiesForContact } from '@/lib/radar/engine';
import { accountShowcaseOrigin } from '@/lib/showcase/account-showcase-url';
import { resolveAssignedAgent } from '@/lib/voice/assigned-agent';
import { assignTagsToContact } from '@/app/api/leads/email-webhook/db-utils';
import type { Disposition } from '@/lib/outreach/dispositions';
import {
  buildCheckinMessage,
  buildCloseNote,
  buildHandoffMessage,
  buildNoMatchesFollowUp,
  formatBudgetINR,
  resolvePlaybook,
  statedBrief,
  DEFAULT_CHECKIN_DAYS,
  type FlowKind,
  type FollowUpContext,
  type PlaybookAction,
} from '@/lib/outreach/playbooks';

/** Quick-reply payload on the opener: `pcf_open:<followup id>`. The
 *  tap routes back through the control dispatch like any Engine
 *  button (control-reply-ids.ts). */
export const POST_CALL_OPEN_PREFIX = 'pcf_open:';

const UNIQUE_VIOLATION = '23505';

export interface FollowUpSnapshot {
  budgetText?: string | null;
  areasText?: string | null;
  agentName?: string | null;
  requirementText?: string | null;
}

export interface OutreachFollowupRow {
  id: string;
  account_id: string;
  contact_id: string;
  action: PlaybookAction;
  disposition: string;
  status: string;
  context: FollowUpSnapshot | null;
}

export type SendPlan =
  | { mode: 'freeform' }
  | { mode: 'opener' }
  | { mode: 'skip'; reason: string };

/**
 * The gate decision, pure so every branch is unit-tested. Order
 * matters: an opt-out beats an open window, and a `note`/`handoff`
 * outside the window is a skip, never a template spend.
 */
export function planSend(args: {
  action: PlaybookAction;
  windowOpen: boolean;
  doNotCall: boolean;
  templateGate: 'ready' | 'marketing' | 'missing';
}): SendPlan {
  if (args.doNotCall) return { mode: 'skip', reason: 'opted_out' };
  if (args.windowOpen) return { mode: 'freeform' };
  if (args.action === 'note' || args.action === 'handoff') {
    return { mode: 'skip', reason: 'window_shut' };
  }
  if (args.templateGate === 'ready') return { mode: 'opener' };
  return {
    mode: 'skip',
    reason:
      args.templateGate === 'marketing'
        ? 'opener_template_marketing'
        : 'opener_template_missing',
  };
}

export function parsePostCallOpenReply(
  replyId: string | null | undefined
): string | null {
  const id = (replyId || '').trim();
  if (!id.startsWith(POST_CALL_OPEN_PREFIX)) return null;
  const followupId = id.slice(POST_CALL_OPEN_PREFIX.length);
  return followupId || null;
}

function snapshotContext(
  contactName: string | null | undefined,
  snapshot: FollowUpSnapshot | null | undefined
): FollowUpContext {
  return {
    contactName: contactName ?? null,
    agentName: snapshot?.agentName ?? null,
    budgetText: snapshot?.budgetText ?? null,
    areasText: snapshot?.areasText ?? null,
  };
}

async function accountOwnerUserId(
  admin: SupabaseClient,
  accountId: string
): Promise<string | null> {
  const { data } = await admin
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .limit(1)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

/** The rich half: the ranked shortlist the qualification ladder sends,
 *  or the honest no-match line. Free-form — callers have already
 *  established the window is open. */
async function sendMatchesPack(args: {
  admin: SupabaseClient;
  accountId: string;
  userId: string | null;
  contact: { id: string; name: string | null };
  ctx: FollowUpContext;
}): Promise<boolean> {
  const { admin, accountId, contact } = args;
  const matches = await rankPropertiesForContact(admin, accountId, contact.id, {
    strictArea: true,
  });
  const text = matches.length
    ? buildMatchesReply(
        contact.name,
        matches,
        await accountShowcaseOrigin(admin, accountId),
        contact.id
      )
    : buildNoMatchesFollowUp(args.ctx);
  const result = await sendWhatsAppMessageAndPersist({
    accountId,
    userId: args.userId,
    contactId: contact.id,
    kind: 'text',
    senderType: 'bot',
    text,
  });
  return result.success;
}

function freeformText(
  action: PlaybookAction,
  disposition: Disposition,
  ctx: FollowUpContext
): string {
  if (action === 'note') return buildCloseNote(disposition, ctx);
  if (action === 'handoff') return buildHandoffMessage(ctx);
  return buildCheckinMessage(ctx);
}

/** The opener template row for this contact's language, and whether it
 *  clears the only gate that reaches every lead: approved AND Utility. */
async function loadOpenerTemplate(
  admin: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<{
  template: {
    name: string;
    language?: string | null;
    body_text: string;
  } | null;
  gate: 'ready' | 'marketing' | 'missing';
}> {
  type Row = {
    name: string;
    language?: string | null;
    status?: string | null;
    category?: string | null;
    body_text: string;
  };
  const language = await resolveSendLanguage(admin, accountId, contactId);
  const { data: rows } = await admin
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', POST_CALL_OPENER_TEMPLATE_NAME);
  const template = pickPostCallOpenerTemplate(
    narrowToLanguage((rows ?? []) as Row[], language)
  );
  if (!template) return { template: null, gate: 'missing' };
  if (!canSendToEveryLead(template))
    return { template: null, gate: 'marketing' };
  return { template, gate: 'ready' };
}

function resolveBodyText(body: string, params: string[]): string {
  return (body || '').replace(/\{\{(\d+)\}\}/g, (_, n) => {
    return params[Number(n) - 1] ?? '';
  });
}

/**
 * Attempts the send a pending follow-up row stands for, and records
 * the outcome on the row: completed (free-form went out), sent (the
 * opener went out, awaiting the tap), skipped (a gate said no, with
 * the reason), or failed.
 */
export async function sendPendingFollowUp(
  admin: SupabaseClient,
  followup: OutreachFollowupRow,
  userId: string | null
): Promise<'completed' | 'sent' | 'skipped' | 'failed'> {
  const accountId = followup.account_id;
  const finish = async (
    status: 'completed' | 'sent' | 'skipped' | 'failed',
    patch: Record<string, unknown> = {}
  ) => {
    await admin
      .from('outreach_followups')
      .update({ status, ...patch })
      .eq('id', followup.id)
      .eq('account_id', accountId)
      .select('id');
    return status;
  };

  try {
    const { data: contact } = await admin
      .from('contacts')
      .select('id, name, phone, do_not_call, is_merged')
      .eq('id', followup.contact_id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!contact?.phone || contact.is_merged) {
      return finish('skipped', { skip_reason: 'contact_unreachable' });
    }

    const { data: conversation } = await admin
      .from('conversations')
      .select('last_customer_message_at')
      .eq('account_id', accountId)
      .eq('contact_id', followup.contact_id)
      .maybeSingle();
    const windowOpen = isWithinCustomerWindow(
      conversation?.last_customer_message_at
    );

    const needsOpener =
      !windowOpen &&
      !contact.do_not_call &&
      (followup.action === 'matches' || followup.action === 'checkin');
    const opener = needsOpener
      ? await loadOpenerTemplate(admin, accountId, followup.contact_id)
      : null;

    const plan = planSend({
      action: followup.action,
      windowOpen,
      doNotCall: contact.do_not_call === true,
      templateGate: opener?.gate ?? 'ready',
    });

    if (plan.mode === 'skip') {
      return finish('skipped', {
        skip_reason: plan.reason,
        window_was_open: windowOpen,
      });
    }

    const ctx = snapshotContext(contact.name, followup.context);

    if (plan.mode === 'freeform') {
      const sent =
        followup.action === 'matches'
          ? await sendMatchesPack({ admin, accountId, userId, contact, ctx })
          : (
              await sendWhatsAppMessageAndPersist({
                accountId,
                userId,
                contactId: contact.id,
                kind: 'text',
                senderType: 'bot',
                text: freeformText(
                  followup.action,
                  followup.disposition as Disposition,
                  ctx
                ),
              })
            ).success;
      if (!sent) return finish('failed', { skip_reason: 'send_failed' });
      return finish('completed', {
        window_was_open: true,
        sent_at: new Date().toISOString(),
      });
    }

    const template = opener!.template!;
    const { data: account } = await admin
      .from('accounts')
      .select('name')
      .eq('id', accountId)
      .maybeSingle();
    const brief = statedBrief(ctx) || followup.context?.requirementText || null;
    const params = buildPostCallOpenerParams(
      contact.name,
      (account as { name?: string | null } | null)?.name ?? null,
      brief
    );
    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId,
      contactId: contact.id,
      kind: 'template',
      senderType: 'bot',
      templateName: template.name,
      templateLanguage: template.language || 'en_US',
      templateParams: [...params],
      messageParams: {
        body: [...params],
        buttonParams: { 0: `${POST_CALL_OPEN_PREFIX}${followup.id}` },
      },
      templateRow: template,
      text: resolveBodyText(template.body_text, [...params]),
    });
    if (!result.success) {
      return finish('failed', { skip_reason: 'send_failed' });
    }
    return finish('sent', {
      window_was_open: false,
      template_used: template.name,
      sent_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[outreach] follow-up send failed:', err);
    return finish('failed', { skip_reason: 'error' });
  }
}

export interface PostCallDispatchArgs {
  accountId: string;
  contactId: string;
  callLogId: string;
  /** Whoever owns the workspace config — task fallback and send actor. */
  userId: string;
  flowKind?: FlowKind;
  disposition: Disposition;
  statedBudgetMin: number | null;
  statedBudgetMax: number | null;
  areas: string[];
  requirementText: string | null;
  /** When the lead said to come back — a `not_now` with a date. */
  checkBackAt: string | null;
}

/**
 * The webhook's entry point: applies the playbook for what the call
 * produced — tags, a task on the agent, and the follow-up row, sending
 * the immediate ones now. Best-effort throughout; never throws.
 */
export async function dispatchPostCallFollowUp(
  args: PostCallDispatchArgs
): Promise<void> {
  try {
    const flowKind = args.flowKind ?? 'buyer_qualification';
    const entry = resolvePlaybook(flowKind, args.disposition);
    if (!entry) return;

    const admin = supabaseAdmin();
    const { data: contact } = await admin
      .from('contacts')
      .select('id, name, assigned_agent_id')
      .eq('id', args.contactId)
      .eq('account_id', args.accountId)
      .maybeSingle();
    if (!contact) return;

    if (entry.tags?.length) {
      await assignTagsToContact(
        admin,
        args.accountId,
        args.userId,
        args.contactId,
        entry.tags
      );
    }

    const agentUserId =
      (contact.assigned_agent_id as string | null) ?? args.userId;
    if (entry.task) {
      const name = (contact.name as string | null)?.trim() || 'this lead';
      const urgent = args.disposition === 'wants_human';
      const due = new Date(
        Date.now() + (urgent ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000)
      );
      await admin.from('todos').insert({
        account_id: args.accountId,
        user_id: args.userId,
        assigned_to: agentUserId,
        title: entry.task.replace('{name}', name),
        due_date: due.toISOString(),
        priority: urgent ? 'high' : 'medium',
        completed: false,
        contact_id: args.contactId,
        source: 'system',
      });
    }

    if (entry.action === 'none') return;

    const agent = await resolveAssignedAgent(
      admin,
      args.accountId,
      agentUserId
    ).catch(() => null);
    const context: FollowUpSnapshot = {
      budgetText: formatBudgetINR(args.statedBudgetMin, args.statedBudgetMax),
      areasText: args.areas.length ? args.areas.join(', ') : null,
      agentName: agent?.name || null,
      requirementText: args.requirementText,
    };

    const checkBackMs = args.checkBackAt ? Date.parse(args.checkBackAt) : NaN;
    const scheduledFor =
      entry.action === 'checkin'
        ? new Date(
            Number.isFinite(checkBackMs) && checkBackMs > Date.now()
              ? checkBackMs
              : Date.now() +
                  (entry.checkinDays ?? DEFAULT_CHECKIN_DAYS) *
                    24 *
                    60 *
                    60 *
                    1000
          ).toISOString()
        : null;

    const { data: inserted, error } = await admin
      .from('outreach_followups')
      .insert({
        account_id: args.accountId,
        contact_id: args.contactId,
        call_log_id: args.callLogId,
        flow_kind: flowKind,
        disposition: args.disposition,
        action: entry.action,
        status: 'pending',
        scheduled_for: scheduledFor,
        context,
      })
      .select('id, account_id, contact_id, action, status, context')
      .single();
    // A redelivered webhook lands here: the row exists, the first
    // delivery owns the send.
    if (error?.code === UNIQUE_VIOLATION) return;
    if (error || !inserted) {
      if (error) console.error('[outreach] follow-up insert failed:', error);
      return;
    }

    if (!scheduledFor) {
      await sendPendingFollowUp(
        admin,
        { ...inserted, disposition: args.disposition } as OutreachFollowupRow,
        args.userId
      );
    }
  } catch (err) {
    console.error('[outreach] dispatch failed:', err);
  }
}

/**
 * The tap on the opener's quick reply — an inbound message, so the
 * window is open by definition; the rich follow-up goes out free-form.
 * True means consumed, whatever the outcome.
 */
export async function handlePostCallOpenReply(args: {
  admin: SupabaseClient;
  accountId: string;
  replyId: string;
  senderPhone: string;
}): Promise<boolean> {
  const followupId = parsePostCallOpenReply(args.replyId);
  if (!followupId) return false;

  try {
    const { admin, accountId } = args;
    const { data: followup } = await admin
      .from('outreach_followups')
      .select(
        'id, account_id, contact_id, action, status, context, disposition'
      )
      .eq('id', followupId)
      .eq('account_id', accountId)
      .maybeSingle();
    // Stale or foreign tap: consumed, silently — the button is ours
    // even when the row is gone.
    if (!followup) return true;
    if (followup.status === 'completed') return true;

    const { data: contact } = await admin
      .from('contacts')
      .select('id, name, phone')
      .eq('id', followup.contact_id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!contact) return true;

    // The tap must come from the lead the follow-up belongs to — a
    // forwarded template's button must not message the original lead.
    const senderDigits = args.senderPhone.replace(/\D/g, '').slice(-8);
    const contactDigits = String(contact.phone || '')
      .replace(/\D/g, '')
      .slice(-8);
    if (!senderDigits || senderDigits !== contactDigits) return true;

    await admin
      .from('outreach_followups')
      .update({ status: 'opened', opened_at: new Date().toISOString() })
      .eq('id', followup.id)
      .eq('account_id', accountId)
      .select('id');

    const userId = await accountOwnerUserId(admin, accountId);
    const ctx = snapshotContext(
      contact.name,
      (followup.context ?? null) as FollowUpSnapshot | null
    );
    const sent =
      followup.action === 'note' || followup.action === 'handoff'
        ? (
            await sendWhatsAppMessageAndPersist({
              accountId,
              userId,
              contactId: contact.id,
              kind: 'text',
              senderType: 'bot',
              text: freeformText(
                followup.action as PlaybookAction,
                followup.disposition as Disposition,
                ctx
              ),
            })
          ).success
        : await sendMatchesPack({
            admin,
            accountId,
            userId,
            contact,
            ctx,
          });

    if (sent) {
      await admin
        .from('outreach_followups')
        .update({ status: 'completed' })
        .eq('id', followup.id)
        .eq('account_id', accountId)
        .select('id');
    }
    return true;
  } catch (err) {
    console.error('[outreach] open-reply handling failed:', err);
    return true;
  }
}

/**
 * The sweep behind the long game: pending rows whose date has arrived
 * (`not_now`'s check-in), sent through the same gates as everything
 * else. Called by /api/cron/outreach-followups.
 */
export async function sweepDueOutreachFollowups(
  now: Date = new Date()
): Promise<{
  due: number;
  completed: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  const admin = supabaseAdmin();
  const summary = { due: 0, completed: 0, sent: 0, skipped: 0, failed: 0 };

  const { data: rows } = await admin
    .from('outreach_followups')
    .select(
      'id, account_id, contact_id, action, status, context, disposition, scheduled_for'
    )
    .eq('status', 'pending')
    .not('scheduled_for', 'is', null)
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(100);

  const owners = new Map<string, string | null>();
  for (const row of rows ?? []) {
    summary.due += 1;
    const accountId = row.account_id as string;
    if (!owners.has(accountId)) {
      owners.set(accountId, await accountOwnerUserId(admin, accountId));
    }
    const outcome = await sendPendingFollowUp(
      admin,
      row as unknown as OutreachFollowupRow,
      owners.get(accountId) ?? null
    );
    summary[outcome] += 1;
  }
  return summary;
}
