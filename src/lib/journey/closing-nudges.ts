// ============================================================
// The closing card — a deal at legal that has stopped moving.
//
// Migration 286 took deals at Token & Legal and Registration out of the
// follow-up radar, because silence there means the work moved to
// lawyers and the sub-registrar rather than that the lead went cold.
// That fixed the wrong message, but it left the deal watched by
// nothing — and a registration slips as often as a lead goes cold.
//
// So the closing card is the radar's sibling, with three deliberate
// differences:
//
//   * It clocks the JOURNEY ITEM's own stage movement, not WhatsApp
//     silence. A buyer who is on the phone to their lawyer daily is
//     silent on WhatsApp and not stalled at all; an item that has not
//     changed stage in a fortnight is stalled whatever the thread says.
//   * Its actions are the next stage, an update request, and a snooze.
//     There is no "mark cold" — a buyer mid-registration is not a cold
//     lead, and recording them as one corrupts the book.
//   * Its wording never calls the deal an enquiry and never offers to
//     close one. The enquiry check-in template does both, which is what
//     made it the wrong message to send here in the first place.
//
// The update request is free-form only, so it reaches the lead when
// their 24-hour window is open and tells the agent to call when it is
// not. No approved template says "how is the paperwork going" — the
// enquiry ones all assert an open enquiry awaiting a decision, which is
// exactly the false statement this card exists to stop. AGENTS.md §2.7
// is why a new template is not minted here on a hunch: a category is
// decided once, unfixable, and a burned name is burned for good.
//
// closing_deal_nudges (migration 287) is the per-item state that keeps
// this from becoming spam.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays } from 'date-fns';

import { CLOSING_STAGE_KINDS } from '@/components/journey/shared';
import { leadFirstName } from '@/lib/contacts/lead-placeholder';
import { resolveConversation } from '@/lib/conversations/resolve';
import { resolveOwnerWhatsAppContact } from '@/lib/inventory/location-requests';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isWithinCustomerWindow } from '@/lib/whatsapp/customer-window';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';

export const CLOSING_ADVANCE_PREFIX = 'cls_next:';
export const CLOSING_ASK_PREFIX = 'cls_ask:';
export const CLOSING_SNOOZE_PREFIX = 'cls_snooze:';

/** No stage movement for this long and the deal is worth a card. Two
 *  weeks, not the radar's 48 hours: legal and registration move in
 *  weeks, and a card every other day would train the agent to ignore
 *  it. */
export const CLOSING_STALL_DAYS = 14;
export const CLOSING_SNOOZE_DAYS = 7;
/** A carded or asked-about deal is held out this long, so one stuck
 *  registration cannot occupy the run every day. */
export const CLOSING_RENUDGE_DAYS = 14;
export const CLOSING_MAX_PER_RUN = 3;

/** Meta's cap on a reply button's title. */
const BUTTON_TITLE_MAX = 20;

const DAY_MS = 24 * 3_600_000;

export interface ClosingAction {
  action: 'advance' | 'ask' | 'snooze';
  itemId: string;
}

export function parseClosingReply(
  replyId: string | null | undefined
): ClosingAction | null {
  const id = (replyId || '').trim();
  const prefixes = [
    [CLOSING_ADVANCE_PREFIX, 'advance'],
    [CLOSING_ASK_PREFIX, 'ask'],
    [CLOSING_SNOOZE_PREFIX, 'snooze'],
  ] as const;
  for (const [prefix, action] of prefixes) {
    if (!id.startsWith(prefix)) continue;
    const itemId = id.slice(prefix.length);
    if (!itemId) return null;
    return { action, itemId };
  }
  return null;
}

export interface ClosingDeal {
  itemId: string;
  contactId: string;
  name: string | null;
  phone: string;
  assignedAgentUserId: string | null;
  propertyTitle: string | null;
  stageName: string;
  /** The stage this item would move to. Null at the end of the board. */
  nextStageName: string | null;
  daysStalled: number;
}

/** The advance button is labelled with the stage it moves to, so the
 *  agent reads "✅ Registration" rather than a generic verb. Sliced by
 *  code point — a custom stage name may carry an emoji of its own. */
export function closingAdvanceButtonTitle(nextStageName: string): string {
  const label = `✅ ${nextStageName}`;
  const chars = [...label];
  if (chars.length <= BUTTON_TITLE_MAX) return label;
  return `${chars.slice(0, BUTTON_TITLE_MAX - 1).join('')}…`;
}

export function buildClosingCardBody(deal: ClosingDeal): string {
  const stalled = `${deal.daysStalled} day${deal.daysStalled === 1 ? '' : 's'}`;
  return [
    '🧾 *Closing in progress*',
    `👤 ${deal.name || deal.phone} · ${deal.phone}`,
    ...(deal.propertyTitle ? [`🏠 ${deal.propertyTitle}`] : []),
    `At *${deal.stageName}* — no movement for ${stalled}.`,
    '',
    [
      deal.nextStageName
        ? `Tap *${deal.nextStageName}* once that step is done.`
        : null,
      'Ask for update messages them if their 24-hour window is open.',
      `Snooze brings this back in ${CLOSING_SNOOZE_DAYS} days.`,
    ]
      .filter(Boolean)
      .join(' '),
  ].join('\n');
}

/** What the bot asks the buyer. Never calls the deal an enquiry, never
 *  asks whether they are still interested, and never offers to close
 *  anything — they are buying it, the question is only where the
 *  paperwork stands. */
export function buildClosingAskText(
  leadName: string | null | undefined,
  propertyTitle: string | null | undefined
): string {
  const first = leadFirstName(leadName);
  const greeting = first ? `Hi ${first}!` : 'Hi!';
  const subject = propertyTitle ? `*${propertyTitle}*` : 'your purchase';
  return `${greeting} Checking in on ${subject} — how is the paperwork going at your end? If anything is waiting on us, tell us here and we'll chase it up.`;
}

interface StageRow {
  id: string;
  name: string;
  position: number;
  stage_kind: string;
}

interface ItemRow {
  id: string;
  contact_id: string;
  property_id: string;
  stage_id: string;
  updated_at: string;
}

async function loadStages(
  db: SupabaseClient,
  accountId: string
): Promise<StageRow[]> {
  const { data } = await db
    .from('journey_stages')
    .select('id, name, position, stage_kind')
    .eq('account_id', accountId)
    .order('position');
  return (data ?? []) as StageRow[];
}

/**
 * The stalled closing deals this account should be carded about right
 * now: an active journey item on a closing stage, no stage movement
 * past the threshold, not snoozed, not carded within the re-nudge
 * window. Longest stalled first, capped.
 */
export async function gatherClosingDeals(
  db: SupabaseClient,
  accountId: string,
  now: Date = new Date()
): Promise<ClosingDeal[]> {
  const stages = await loadStages(db, accountId);
  const closingIds = stages
    .filter((s) => CLOSING_STAGE_KINDS.includes(s.stage_kind as never))
    .map((s) => s.id);
  if (!closingIds.length) return [];

  const { data: itemRows } = await db
    .from('journey_items')
    .select('id, contact_id, property_id, stage_id, updated_at')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .in('stage_id', closingIds);
  const items = (itemRows ?? []) as ItemRow[];
  if (!items.length) return [];

  const cutoff = now.getTime() - CLOSING_STALL_DAYS * DAY_MS;
  const stalled = items.filter(
    (i) => new Date(i.updated_at).getTime() <= cutoff
  );
  if (!stalled.length) return [];

  // Every `.in()` below is bounded by the account's in-flight deals —
  // items sitting on a closing stage, which is a handful even for a
  // busy brokerage, not a list that grows with account history.
  const { data: nudges } = await db
    .from('closing_deal_nudges')
    .select('item_id, last_nudged_at, snoozed_until')
    .eq('account_id', accountId)
    .in(
      'item_id',
      stalled.map((i) => i.id)
    );
  const held = new Set<string>();
  const renudgeCutoff = now.getTime() - CLOSING_RENUDGE_DAYS * DAY_MS;
  for (const n of nudges ?? []) {
    const snoozed =
      n.snoozed_until && new Date(n.snoozed_until).getTime() > now.getTime();
    const recent =
      n.last_nudged_at && new Date(n.last_nudged_at).getTime() > renudgeCutoff;
    if (snoozed || recent) held.add(n.item_id);
  }
  const candidates = stalled.filter((i) => !held.has(i.id));
  if (!candidates.length) return [];

  const { data: contactRows } = await db
    .from('contacts')
    .select('id, name, phone, assigned_agent_id')
    .eq('account_id', accountId)
    .in('id', [...new Set(candidates.map((c) => c.contact_id))]);
  const contacts = new Map(
    (
      (contactRows ?? []) as {
        id: string;
        name: string | null;
        phone: string | null;
        assigned_agent_id: string | null;
      }[]
    ).map((c) => [c.id, c])
  );

  const due = candidates
    .filter((i) => contacts.get(i.contact_id)?.phone)
    // Oldest stage movement first — the deal that has been still the
    // longest is the one most likely to have quietly died.
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .slice(0, CLOSING_MAX_PER_RUN);
  if (!due.length) return [];

  const { data: propertyRows } = await db
    .from('properties')
    .select('id, title')
    .eq('account_id', accountId)
    .in(
      'id',
      due.map((i) => i.property_id)
    );
  const titles = new Map(
    ((propertyRows ?? []) as { id: string; title: string }[]).map((p) => [
      p.id,
      p.title,
    ])
  );

  return due.map((item) => {
    const contact = contacts.get(item.contact_id);
    const idx = stages.findIndex((s) => s.id === item.stage_id);
    return {
      itemId: item.id,
      contactId: item.contact_id,
      name: contact?.name ?? null,
      phone: contact?.phone as string,
      assignedAgentUserId: contact?.assigned_agent_id ?? null,
      propertyTitle: titles.get(item.property_id) ?? null,
      stageName: stages[idx]?.name ?? 'closing',
      nextStageName: idx >= 0 ? (stages[idx + 1]?.name ?? null) : null,
      daysStalled: Math.max(
        1,
        Math.floor(
          (now.getTime() - new Date(item.updated_at).getTime()) / DAY_MS
        )
      ),
    };
  });
}

async function stampNudgeState(
  db: SupabaseClient,
  accountId: string,
  itemId: string,
  patch: { last_nudged_at?: string; snoozed_until?: string | null }
): Promise<void> {
  await db.from('closing_deal_nudges').upsert(
    {
      account_id: accountId,
      item_id: itemId,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,item_id' }
  );
}

/**
 * The cron's other half: for every connected Official-API account, card
 * the routed agent about each stalled closing deal. Idempotent day to
 * day — the last_nudged_at stamp holds a carded deal out for a
 * fortnight.
 */
export async function sendClosingDealNudges(
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
      const deals = await gatherClosingDeals(admin, accountId, now);
      if (!deals.length) continue;
      accounts += 1;

      for (const deal of deals) {
        const agentUserId =
          deal.assignedAgentUserId || (config.user_id as string);
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
          interactiveBody: buildClosingCardBody(deal),
          interactiveButtons: [
            ...(deal.nextStageName
              ? [
                  {
                    id: `${CLOSING_ADVANCE_PREFIX}${deal.itemId}`,
                    title: closingAdvanceButtonTitle(deal.nextStageName),
                  },
                ]
              : []),
            {
              id: `${CLOSING_ASK_PREFIX}${deal.itemId}`,
              title: '📄 Ask for update',
            },
            {
              id: `${CLOSING_SNOOZE_PREFIX}${deal.itemId}`,
              title: `⏰ Snooze ${CLOSING_SNOOZE_DAYS} days`,
            },
          ],
        });
        if (!result.success) continue;
        nudges += 1;
        await stampNudgeState(admin, accountId, deal.itemId, {
          last_nudged_at: now.toISOString(),
        });
      }
    } catch (err) {
      console.error(`[closing-nudges] account ${accountId} failed:`, err);
    }
  }
  return { accounts, nudges };
}

/**
 * Acts on a closing-card tap. Same contract as the radar's handler: the
 * tap arrives in the AGENT's thread, every action operates on the
 * journey item, and true means consumed — the tap must never fall
 * through to the owner chatbot underneath it.
 */
export async function handleClosingReply(
  action: ClosingAction,
  accountId: string,
  configOwnerUserId: string,
  agentThread: { contactId: string; conversationId: string }
): Promise<boolean> {
  const admin = supabaseAdmin();

  const { data: itemData } = await admin
    .from('journey_items')
    .select('id, contact_id, property_id, stage_id, status')
    .eq('id', action.itemId)
    .eq('account_id', accountId)
    .maybeSingle();
  const item = itemData as (ItemRow & { status: string }) | null;
  if (!item) return false;

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

  if (item.status !== 'active') {
    await confirmToAgent(
      '🗂 That deal is no longer on the journey board, so nothing was changed.'
    );
    return true;
  }

  if (action.action === 'snooze') {
    await stampNudgeState(admin, accountId, action.itemId, {
      snoozed_until: addDays(new Date(), CLOSING_SNOOZE_DAYS).toISOString(),
    });
    await confirmToAgent(
      `⏰ Snoozed — this deal comes back in ${CLOSING_SNOOZE_DAYS} days.`
    );
    return true;
  }

  const { data: contact } = await admin
    .from('contacts')
    .select('id, name, phone')
    .eq('id', item.contact_id)
    .eq('account_id', accountId)
    .maybeSingle();
  const lead = contact as {
    id: string;
    name: string | null;
    phone: string | null;
  } | null;
  const who = lead?.name || lead?.phone || 'this buyer';

  if (action.action === 'advance') {
    const stages = await loadStages(admin, accountId);
    const idx = stages.findIndex((s) => s.id === item.stage_id);
    const next = idx >= 0 ? stages[idx + 1] : undefined;
    if (!next) {
      await confirmToAgent(
        `🏁 ${who} is already on the last stage of the board — nothing further to move to.`
      );
      return true;
    }
    await admin
      .from('journey_items')
      .update({
        stage_id: next.id,
        // The step just happened, so a plan pointing at it is spent.
        planned_stage_id: null,
        planned_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('account_id', accountId);
    const { error: evError } = await admin.from('journey_events').insert({
      account_id: accountId,
      item_id: item.id,
      event_type: 'advanced',
      from_stage_id: item.stage_id,
      to_stage_id: next.id,
      reason: 'Agent advanced the deal from the closing card',
      created_by: configOwnerUserId,
    });
    if (evError)
      console.error('[closing-nudges] advance event failed:', evError.message);
    await confirmToAgent(
      `✅ Moved ${who} to *${next.name}*. The stall clock restarts from today.`
    );
    return true;
  }

  if (!lead?.phone) {
    await confirmToAgent(
      `⚠️ ${who} has no WhatsApp number on file — open the contact to add one.`
    );
    return true;
  }

  const { conversation } = await resolveConversation<{ id: string }>(admin, {
    accountId,
    contactId: lead.id,
    userId: configOwnerUserId,
    columns: 'id',
  });
  if (!conversation) return false;

  const { data: lastCustomer } = await admin
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Free-form or nothing. The approved templates all frame the reader
  // as having an open enquiry awaiting a decision, which is the false
  // statement this card exists to stop sending.
  if (!isWithinCustomerWindow(lastCustomer?.created_at)) {
    await confirmToAgent(
      `📵 ${who}'s 24-hour window is closed, so the bot can't message them about the paperwork — give them a call instead.`
    );
    return true;
  }

  const { data: property } = await admin
    .from('properties')
    .select('id, title')
    .eq('id', item.property_id)
    .eq('account_id', accountId)
    .maybeSingle();

  const result = await sendWhatsAppMessageAndPersist({
    accountId,
    userId: configOwnerUserId,
    contactId: lead.id,
    conversationId: conversation.id,
    kind: 'text',
    senderType: 'bot',
    text: buildClosingAskText(
      lead.name,
      (property as { title?: string | null } | null)?.title ?? null
    ),
  });

  if (result.success) {
    await stampNudgeState(admin, accountId, action.itemId, {
      snoozed_until: addDays(new Date(), CLOSING_RENUDGE_DAYS).toISOString(),
    });
    await confirmToAgent(`✅ Asked ${who} where the paperwork stands.`);
  } else {
    await confirmToAgent(
      `⚠️ Couldn't reach ${who} on WhatsApp — open the thread to follow up by hand.`
    );
  }
  return true;
}
