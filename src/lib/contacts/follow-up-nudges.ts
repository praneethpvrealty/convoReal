// ============================================================
// The follow-up radar — quiet HOT leads, delivered as a card.
//
// The Today page already lists hot leads gone quiet, but a panel only
// works on the day the agent opens it. A ₹5-10 Cr lead who said "we
// can talk whenever" went six days unanswered that way. The daily cron
// (/api/cron/follow-up-nudges) now sends the assigned agent a WhatsApp
// card per quiet lead — the same shape as the enquiry card, because
// that shape is what gets acted on:
//
//   💬 Check in     — the bot nudges the lead: free-form inside their
//                     24-hour window, the approved enquiry_checkin
//                     template outside it.
//   ⏰ Snooze 3 days — the card comes back later.
//   ❄️ Mark cold     — lead_temp = COLD; the radar drops them.
//
// follow_up_nudges (migration 272) is the per-lead state that keeps
// this from becoming spam: never more than one card per lead per
// FOLLOWUP_RENUDGE_DAYS, and snoozes are honoured.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays } from 'date-fns';

import type { Property } from '@/types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { resolveOwnerWhatsAppContact } from '@/lib/inventory/location-requests';
import { resolveConversation } from '@/lib/conversations/resolve';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import { isPlaceholderLeadName } from '@/lib/contacts/lead-placeholder';
import { describeEnquiredProperty } from '@/lib/whatsapp/enquiry-notice-template';
import {
  buildJourneyCheckinParams,
  journeyCheckinUrlSuffix,
  pickJourneyCheckinTemplate,
} from '@/lib/whatsapp/journey-checkin-template';
import {
  narrowToLanguage,
  resolveSendLanguage,
} from '@/lib/whatsapp/template-language';

export const FOLLOWUP_CHECKIN_PREFIX = 'fup_checkin:';
export const FOLLOWUP_SNOOZE_PREFIX = 'fup_snooze:';
export const FOLLOWUP_COLD_PREFIX = 'fup_cold:';

export const FOLLOWUP_SILENCE_HOURS = 48;
export const FOLLOWUP_SNOOZE_DAYS = 3;
/** A check-in or an untouched card both hold the lead out of the radar
 *  this long, so the same person is never nudged about twice a week. */
export const FOLLOWUP_RENUDGE_DAYS = 7;
/** Cards per account per run — past this the agent should be working
 *  the inbox, not archiving cards. */
export const FOLLOWUP_MAX_PER_RUN = 3;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface FollowUpAction {
  action: 'checkin' | 'snooze' | 'cold';
  contactId: string;
}

export function parseFollowUpReply(
  replyId: string | null | undefined
): FollowUpAction | null {
  const id = (replyId || '').trim();
  const prefixes = [
    [FOLLOWUP_CHECKIN_PREFIX, 'checkin'],
    [FOLLOWUP_SNOOZE_PREFIX, 'snooze'],
    [FOLLOWUP_COLD_PREFIX, 'cold'],
  ] as const;
  for (const [prefix, action] of prefixes) {
    if (!id.startsWith(prefix)) continue;
    const contactId = id.slice(prefix.length);
    if (!contactId) return null;
    return { action, contactId };
  }
  return null;
}

export interface FollowUpLead {
  contactId: string;
  name: string | null;
  phone: string;
  assignedAgentUserId: string | null;
  daysSilent: number;
  propertyTitle: string | null;
}

/** First name for a greeting, or nothing when the lead is filed under a
 *  placeholder like "Housing Lead" or their own phone number. */
function firstName(name: string | null | undefined): string {
  const raw = (name || '').trim();
  if (!raw || isPlaceholderLeadName(raw)) return '';
  return raw.split(/\s+/)[0];
}

export function buildFollowUpCardBody(lead: FollowUpLead): string {
  return [
    '⏰ *Follow-up due*',
    `👤 ${lead.name || lead.phone} · ${lead.phone}`,
    ...(lead.propertyTitle ? [`🏠 ${lead.propertyTitle}`] : []),
    `Hot lead — quiet for ${lead.daysSilent} day${lead.daysSilent === 1 ? '' : 's'}.`,
    '',
    'Check in sends them a friendly nudge from the bot and reopens the conversation. Snooze brings this back in 3 days.',
  ].join('\n');
}

/** What the bot says to the lead when the agent taps Check in inside
 *  the 24-hour window. Outside it, the approved template asks the same
 *  question. */
export function buildFollowUpCheckinText(
  leadName: string | null | undefined,
  propertyTitle: string | null | undefined
): string {
  const first = firstName(leadName);
  const greeting = first ? `Hi ${first}!` : 'Hi!';
  const subject = propertyTitle ? `*${propertyTitle}*` : 'your property search';
  return `${greeting} Just checking in on ${subject} — where do you stand? If you'd like to talk it over or plan a visit, reply here and we'll set it up.`;
}

/**
 * The quiet HOT leads this account should be nudged about right now:
 * lead_temp HOT, silent past the threshold, not snoozed, not nudged
 * within the re-nudge window. Longest silent first, capped.
 */
export async function gatherFollowUpLeads(
  db: SupabaseClient,
  accountId: string,
  now: Date = new Date()
): Promise<FollowUpLead[]> {
  const { data: contacts } = await db
    .from('contacts')
    .select(
      'id, name, phone, last_contacted_at, created_at, assigned_agent_id, last_inquired_property_id'
    )
    .eq('account_id', accountId)
    .eq('is_merged', false)
    .eq('lead_temp', 'HOT')
    .in('status', ['active', 'pending_review']);
  if (!contacts?.length) return [];

  const cutoff = now.getTime() - FOLLOWUP_SILENCE_HOURS * HOUR_MS;
  type Row = {
    id: string;
    name: string | null;
    phone: string | null;
    last_contacted_at: string | null;
    created_at: string;
    assigned_agent_id: string | null;
    last_inquired_property_id: string | null;
  };
  const quiet = (contacts as Row[]).filter((c) => {
    if (!c.phone) return false;
    const lastTouch = c.last_contacted_at
      ? new Date(c.last_contacted_at).getTime()
      : new Date(c.created_at).getTime();
    return lastTouch <= cutoff;
  });
  if (!quiet.length) return [];

  const { data: nudges } = await db
    .from('follow_up_nudges')
    .select('contact_id, last_nudged_at, snoozed_until')
    .eq('account_id', accountId)
    .in(
      'contact_id',
      quiet.map((c) => c.id)
    );
  const held = new Set<string>();
  const renudgeCutoff = now.getTime() - FOLLOWUP_RENUDGE_DAYS * DAY_MS;
  for (const n of nudges ?? []) {
    const snoozed =
      n.snoozed_until && new Date(n.snoozed_until).getTime() > now.getTime();
    const recent =
      n.last_nudged_at && new Date(n.last_nudged_at).getTime() > renudgeCutoff;
    if (snoozed || recent) held.add(n.contact_id);
  }

  const due = quiet
    .filter((c) => !held.has(c.id))
    .map((c) => {
      const lastTouch = c.last_contacted_at
        ? new Date(c.last_contacted_at).getTime()
        : new Date(c.created_at).getTime();
      return {
        contactId: c.id,
        name: c.name,
        phone: c.phone as string,
        assignedAgentUserId: c.assigned_agent_id,
        daysSilent: Math.max(
          1,
          Math.floor((now.getTime() - lastTouch) / DAY_MS)
        ),
        propertyId: c.last_inquired_property_id,
        propertyTitle: null as string | null,
      };
    })
    .sort((a, b) => b.daysSilent - a.daysSilent)
    .slice(0, FOLLOWUP_MAX_PER_RUN);

  const propertyIds = due.map((l) => l.propertyId).filter(Boolean) as string[];
  if (propertyIds.length) {
    const { data: properties } = await db
      .from('properties')
      .select('id, title')
      .eq('account_id', accountId)
      .in('id', propertyIds);
    const titles = new Map(
      (properties ?? []).map((p: { id: string; title: string }) => [
        p.id,
        p.title,
      ])
    );
    for (const lead of due) {
      lead.propertyTitle = lead.propertyId
        ? (titles.get(lead.propertyId) ?? null)
        : null;
    }
  }

  return due.map(
    ({
      contactId,
      name,
      phone,
      assignedAgentUserId,
      daysSilent,
      propertyTitle,
    }) => ({
      contactId,
      name,
      phone,
      assignedAgentUserId,
      daysSilent,
      propertyTitle,
    })
  );
}

async function stampNudgeState(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  patch: { last_nudged_at?: string; snoozed_until?: string | null }
): Promise<void> {
  await db.from('follow_up_nudges').upsert(
    {
      account_id: accountId,
      contact_id: contactId,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,contact_id' }
  );
}

/**
 * The cron's whole job: for every connected Official-API account, card
 * the routed agent about each quiet hot lead. Idempotent day to day —
 * the last_nudged_at stamp holds a carded lead out for a week.
 */
export async function sendFollowUpNudges(
  now: Date = new Date()
): Promise<{ accounts: number; nudges: number }> {
  const admin = supabaseAdmin();
  const { data: configs } = await admin
    .from('whatsapp_config')
    .select('account_id, user_id')
    .eq('integration_type', 'official_api')
    .eq('status', 'connected');

  let accounts = 0;
  let nudges = 0;
  for (const config of configs ?? []) {
    const accountId = config.account_id as string;
    try {
      const leads = await gatherFollowUpLeads(admin, accountId, now);
      if (!leads.length) continue;
      accounts += 1;

      for (const lead of leads) {
        const agentUserId =
          lead.assignedAgentUserId || (config.user_id as string);
        const agent = await resolveOwnerWhatsAppContact(
          admin,
          accountId,
          agentUserId
        );
        if (!agent) continue;

        const result = await sendWhatsAppMessageAndPersist({
          accountId,
          userId: agentUserId,
          ...(agent.contactId
            ? { contactId: agent.contactId }
            : { toPhone: agent.phone }),
          kind: 'interactive',
          senderType: 'bot',
          interactiveType: 'buttons',
          interactiveBody: buildFollowUpCardBody(lead),
          interactiveButtons: [
            {
              id: `${FOLLOWUP_CHECKIN_PREFIX}${lead.contactId}`,
              title: '💬 Check in',
            },
            {
              id: `${FOLLOWUP_SNOOZE_PREFIX}${lead.contactId}`,
              title: '⏰ Snooze 3 days',
            },
            {
              id: `${FOLLOWUP_COLD_PREFIX}${lead.contactId}`,
              title: '❄️ Mark cold',
            },
          ],
        });
        if (!result.success) continue;
        nudges += 1;
        await stampNudgeState(admin, accountId, lead.contactId, {
          last_nudged_at: now.toISOString(),
        });
      }
    } catch (err) {
      console.error(`[follow-up-nudges] account ${accountId} failed:`, err);
    }
  }
  return { accounts, nudges };
}

/**
 * Acts on a card tap. Same contract as the enquiry card's handler: the
 * tap arrives in the AGENT's thread, every action operates on the
 * LEAD's, and true means consumed — the tap must never fall through to
 * the owner chatbot underneath it.
 */
export async function handleFollowUpReply(
  action: FollowUpAction,
  accountId: string,
  configOwnerUserId: string,
  agentThread: { contactId: string; conversationId: string }
): Promise<boolean> {
  const admin = supabaseAdmin();

  const { data: lead } = await admin
    .from('contacts')
    .select('id, name, phone, last_inquired_property_id')
    .eq('id', action.contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!lead?.phone) return false;

  const confirmToAgent = async (text: string) => {
    await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: agentThread.contactId,
      conversationId: agentThread.conversationId,
      kind: 'text',
      senderType: 'bot',
      text,
    });
  };
  const who = lead.name || lead.phone;

  if (action.action === 'cold') {
    await admin
      .from('contacts')
      .update({ lead_temp: 'COLD', updated_at: new Date().toISOString() })
      .eq('id', action.contactId)
      .eq('account_id', accountId);
    await confirmToAgent(
      `❄️ Marked ${who} cold — the follow-up radar will leave them alone.`
    );
    return true;
  }

  if (action.action === 'snooze') {
    await stampNudgeState(admin, accountId, action.contactId, {
      snoozed_until: addDays(new Date(), FOLLOWUP_SNOOZE_DAYS).toISOString(),
    });
    await confirmToAgent(
      `⏰ Snoozed — ${who} comes back in ${FOLLOWUP_SNOOZE_DAYS} days.`
    );
    return true;
  }

  const { conversation } = await resolveConversation<{ id: string }>(admin, {
    accountId,
    contactId: action.contactId,
    userId: configOwnerUserId,
    columns: 'id',
  });
  if (!conversation) return false;

  const property = lead.last_inquired_property_id
    ? ((
        await admin
          .from('properties')
          .select(
            'id, title, property_code, bedrooms, sublocality, city, location'
          )
          .eq('id', lead.last_inquired_property_id)
          .eq('account_id', accountId)
          .maybeSingle()
      ).data as Property | null)
    : null;

  const { data: lastCustomer } = await admin
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let sent = false;
  if (isWithinCustomerWindow(lastCustomer?.created_at)) {
    const result = await sendWhatsAppMessageAndPersist({
      accountId,
      userId: configOwnerUserId,
      contactId: action.contactId,
      conversationId: conversation.id,
      kind: 'text',
      senderType: 'bot',
      text: buildFollowUpCheckinText(lead.name, property?.title),
    });
    sent = result.success;
  } else {
    sent = await sendCheckinTemplate({
      db: admin,
      accountId,
      userId: configOwnerUserId,
      contactId: action.contactId,
      conversationId: conversation.id,
      contactName: lead.name,
      property,
    });
    if (!sent) {
      await confirmToAgent(
        `⚠️ Couldn't check in with ${who} — their 24-hour window is closed and the check-in template isn't approved yet. Open the thread to reach them with a template by hand.`
      );
      return true;
    }
  }

  if (sent) {
    await stampNudgeState(admin, accountId, action.contactId, {
      snoozed_until: addDays(new Date(), FOLLOWUP_RENUDGE_DAYS).toISOString(),
    });
    await confirmToAgent(`✅ Check-in sent to ${who} on WhatsApp.`);
  } else {
    await confirmToAgent(
      `⚠️ Couldn't reach ${who} on WhatsApp — open the thread to follow up by hand.`
    );
  }
  return true;
}

/** The closed-window path: the approved enquiry check-in template, the
 *  same row the journey sheet sends. False when no approved row exists
 *  or the send fails. */
async function sendCheckinTemplate(args: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  contactName: string | null;
  property: Property | null;
}): Promise<boolean> {
  const { db, accountId } = args;
  type Row = {
    name: string;
    language?: string | null;
    status?: string | null;
    category?: string | null;
    body_text: string;
  };
  const language = await resolveSendLanguage(db, accountId, args.contactId);
  const { data: rows } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', 'enquiry_checkin_notice');
  const template = pickJourneyCheckinTemplate(
    narrowToLanguage((rows ?? []) as Row[], language)
  );
  if (!template) return false;

  const { data: account } = await db
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .maybeSingle();

  const params = buildJourneyCheckinParams(
    args.contactName,
    (account as { name?: string | null } | null)?.name ?? null,
    args.property ? describeEnquiredProperty(args.property) : 'your enquiry'
  );
  const urlSuffix = args.property
    ? journeyCheckinUrlSuffix(args.property, args.contactId)
    : null;

  const result = await sendWhatsAppMessageAndPersist({
    accountId,
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    kind: 'template',
    senderType: 'bot',
    templateName: template.name,
    templateLanguage: (template as Row).language || 'en_US',
    templateParams: [...params],
    messageParams: {
      body: [...params],
      // The URL button sits after the two quick replies, so index 2.
      ...(urlSuffix ? { buttonParams: { 2: urlSuffix } } : {}),
    },
    templateRow: template,
    text: resolveBodyText((template as Row).body_text, [...params]),
  });
  return result.success;
}

function resolveBodyText(body: string, params: string[]): string {
  return (body || '').replace(/\{\{(\d+)\}\}/g, (_, n) => {
    return params[Number(n) - 1] ?? '';
  });
}
