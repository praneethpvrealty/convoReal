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
import { leadFirstName } from '@/lib/contacts/lead-placeholder';
import {
  collapseToParties,
  loadContactParties,
  partyDisplayName,
  partyLastTouch,
} from '@/lib/contacts/parties';
import { loadPastEnquiryContacts } from '@/lib/journey/past-enquiry';
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
  /** Set when this lead buys with others — a couple, or colleagues from
   *  one firm. The card names the party and the actions still operate on
   *  the contact we address. */
  partyName?: string | null;
  /** Every member of the party, including the addressed contact. Empty
   *  for a lead who buys alone. */
  partyContactIds?: string[];
}

export function buildFollowUpCardBody(lead: FollowUpLead): string {
  // With a party the headline is the deal, and the line below says who
  // the check-in would actually reach — an agent must never tap Check
  // in wondering which of the two people gets the message.
  const who = lead.partyName
    ? [`👥 ${lead.partyName}`, `↳ we'd message ${lead.name || lead.phone} · ${lead.phone}`]
    : [`👤 ${lead.name || lead.phone} · ${lead.phone}`];
  return [
    '⏰ *Follow-up due*',
    ...who,
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
  const first = leadFirstName(leadName);
  const greeting = first ? `Hi ${first}!` : 'Hi!';
  const subject = propertyTitle ? `*${propertyTitle}*` : 'your property search';
  return `${greeting} Just checking in on ${subject} — where do you stand? If you'd like to talk it over or plan a visit, reply here and we'll set it up.`;
}

/**
 * The quiet HOT leads this account should be nudged about right now:
 * lead_temp HOT, silent past the threshold, not already closing, not
 * snoozed, not nudged within the re-nudge window. Longest silent first,
 * capped.
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
  // Silence is per WhatsApp thread, which is wrong for people buying
  // together: a reply from the wife never reset the husband's clock, so
  // both were carded as quiet on one listing while the deal was in
  // active contact. The party's clock is its most recently contacted
  // member, and every member reads from it.
  const parties = await loadContactParties(db, accountId);
  const touchOf = (c: Row) => c.last_contacted_at ?? c.created_at;
  const touchByContactId = new Map(
    (contacts as Row[]).map((c) => [c.id, touchOf(c)])
  );
  // Members outside the HOT/active filter above still count: the wife
  // may be filed COLD and still be the one who replied. Bounded by the
  // account's party membership, which is a handful of rows.
  const memberIds = [...new Set([...parties.values()].flatMap((p) => p.memberIds))]
    .filter((id) => !touchByContactId.has(id));
  if (memberIds.length) {
    const { data: memberRows } = await db
      .from('contacts')
      .select('id, last_contacted_at, created_at')
      .eq('account_id', accountId)
      .in('id', memberIds);
    for (const m of (memberRows ?? []) as {
      id: string;
      last_contacted_at: string | null;
      created_at: string;
    }[]) {
      touchByContactId.set(m.id, m.last_contacted_at ?? m.created_at);
    }
  }
  const lastTouchFor = (c: Row): number => {
    const party = parties.get(c.id);
    if (!party) return new Date(touchOf(c)).getTime();
    const touches = party.memberIds.map(
      (id) => touchByContactId.get(id) ?? null
    );
    return partyLastTouch(touches) ?? new Date(touchOf(c)).getTime();
  };

  const quiet = (contacts as Row[]).filter((c) => {
    if (!c.phone) return false;
    return lastTouchFor(c) <= cutoff;
  });
  if (!quiet.length) return [];

  // Silence on a deal already at legal or registration means the work
  // moved offline, not that the lead went cold. Applied before the cap
  // so a closing deal never spends one of the run's three cards.
  const pastEnquiry = await loadPastEnquiryContacts(db, accountId);

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

  // A hold or a closing deal on ANY member covers the whole party: one
  // agent snoozing the husband must not leave the wife's card to fire
  // tomorrow, which is the duplicate this feature exists to stop.
  const heldParty = (c: Row) => {
    const party = parties.get(c.id);
    const ids = party ? party.memberIds : [c.id];
    return ids.some((id) => held.has(id) || pastEnquiry.has(id));
  };

  const due = collapseToParties(
    quiet.filter((c) => !heldParty(c)),
    (c) => c.id,
    parties
  )
    .map(({ row: c, party, alsoInvolved }) => {
      const names = party
        ? [c.name ?? '', ...alsoInvolved.map((m) => m.name ?? '')]
        : [];
      return {
        contactId: c.id,
        name: c.name,
        phone: c.phone as string,
        assignedAgentUserId: c.assigned_agent_id,
        daysSilent: Math.max(
          1,
          Math.floor((now.getTime() - lastTouchFor(c)) / DAY_MS)
        ),
        propertyId: c.last_inquired_property_id,
        propertyTitle: null as string | null,
        partyName: partyDisplayName(party, names),
        partyContactIds: party ? party.memberIds : [],
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
      partyName,
      partyContactIds,
    }) => ({
      partyName,
      partyContactIds,
      contactId,
      name,
      phone,
      assignedAgentUserId,
      daysSilent,
      propertyTitle,
    })
  );
}

/**
 * Stamps the hold on every member of the lead's party, not just the
 * contact we addressed. Snoozing the husband and being shown the wife's
 * card the next morning is precisely the duplicate parties exist to
 * stop, and the state table is keyed by contact.
 */
async function stampNudgeState(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  patch: { last_nudged_at?: string; snoozed_until?: string | null },
  alsoContactIds: string[] = []
): Promise<void> {
  const ids = [...new Set([contactId, ...alsoContactIds])];
  await db.from('follow_up_nudges').upsert(
    ids.map((id) => ({
      account_id: accountId,
      contact_id: id,
      ...patch,
      updated_at: new Date().toISOString(),
    })),
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
        await stampNudgeState(
          admin,
          accountId,
          lead.contactId,
          { last_nudged_at: now.toISOString() },
          lead.partyContactIds ?? []
        );
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
  // The tap acts on the deal, so it acts on everyone buying together.
  // Anything less and the other half of the couple keeps their own
  // radar state — snoozed here, carded tomorrow.
  const parties = await loadContactParties(admin, accountId);
  const party = parties.get(action.contactId);
  const partyIds = party ? party.memberIds : [action.contactId];

  const { data: memberRows } = party
    ? await admin
        .from('contacts')
        .select('id, name')
        .eq('account_id', accountId)
        .in('id', party.memberIds)
    : { data: null };
  const who =
    partyDisplayName(
      party ?? null,
      ((memberRows ?? []) as { name: string | null }[]).map((m) => m.name ?? '')
    ) ||
    lead.name ||
    lead.phone;

  // Re-checked here and not only in the gather step: a card is a
  // WhatsApp button that can be tapped days later, by which time the
  // lead may have moved to legal. Every action is refused rather than
  // just the check-in — marking a buyer mid-registration COLD corrupts
  // the record as surely as telling them their enquiry is still open.
  const pastEnquiry = await loadPastEnquiryContacts(admin, accountId);
  const closingStage = partyIds
    .map((id) => pastEnquiry.get(id))
    .find((stage): stage is string => Boolean(stage));
  if (closingStage) {
    await confirmToAgent(
      `🧾 ${who} is at *${closingStage}* — this deal is already in progress, so nothing was sent. Update the journey instead if the paperwork has moved.`
    );
    return true;
  }

  if (action.action === 'cold') {
    // The whole party goes cold: they share one requirement, so leaving
    // the spouse HOT would just re-card the same dead deal.
    await admin
      .from('contacts')
      .update({ lead_temp: 'COLD', updated_at: new Date().toISOString() })
      .in('id', partyIds)
      .eq('account_id', accountId);
    await confirmToAgent(
      `❄️ Marked ${who} cold — the follow-up radar will leave them alone.`
    );
    return true;
  }

  if (action.action === 'snooze') {
    await stampNudgeState(
      admin,
      accountId,
      action.contactId,
      {
        snoozed_until: addDays(new Date(), FOLLOWUP_SNOOZE_DAYS).toISOString(),
      },
      partyIds
    );
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
    await stampNudgeState(
      admin,
      accountId,
      action.contactId,
      {
        snoozed_until: addDays(new Date(), FOLLOWUP_RENUDGE_DAYS).toISOString(),
      },
      partyIds
    );
    await confirmToAgent(
      party
        ? `✅ Check-in sent to ${lead.name || lead.phone} on WhatsApp, for ${who}.`
        : `✅ Check-in sent to ${who} on WhatsApp.`
    );
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
