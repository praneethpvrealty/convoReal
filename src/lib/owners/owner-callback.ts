import type { SupabaseClient } from '@supabase/supabase-js';
import { createNotification } from '@/lib/notifications/create';
import { BRIDGE_REPLY_HINT } from '@/lib/whatsapp/reply-bridge';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DEFAULT_DUE_MS = 60 * 60 * 1000;
const REPEAT_WINDOW_MS = 6 * 60 * 60 * 1000;

const CLOCK_TIME =
  /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])/i;

export interface RequestedCallTime {
  at: Date;
  label: string;
}

export function requestedCallTime(
  text: string,
  now: Date = new Date()
): RequestedCallTime | null {
  const match = CLOCK_TIME.exec(text || '');
  if (!match) return null;
  const hour12 = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const pm = /^p/i.test(match[3]);
  const hour = (hour12 % 12) + (pm ? 12 : 0);
  const tomorrow = /\b(?:tomorrow|tmrw|tmr)\b/i.test(text);
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const at = new Date(
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate() + (tomorrow ? 1 : 0),
      hour,
      minute
    ) - IST_OFFSET_MS
  );
  if (at.getTime() <= now.getTime()) return null;
  const after = /\bafter\b/i.test(text.slice(0, match.index));
  return {
    at,
    label: `${after ? 'after' : 'at'} ${hour12}:${String(minute).padStart(2, '0')} ${
      pm ? 'pm' : 'am'
    } ${tomorrow ? 'tomorrow' : 'today'}`,
  };
}

export interface OwnerCallback {
  filed: boolean;
  when: string | null;
}

export async function fileOwnerCallback(
  db: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    agentUserId: string;
    contactId: string;
    contactName: string | null;
    contactPhone: string | null;
    conversationId: string;
    text: string;
    listingTitles: string[];
    now?: Date;
  }
): Promise<OwnerCallback> {
  const now = args.now ?? new Date();
  const requested = requestedCallTime(args.text, now);
  const when = requested?.label ?? null;

  const { data: open, error: openError } = await db
    .from('todos')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('completed', false)
    .eq('source', 'system')
    .ilike('title', 'Call back % (owner)%')
    .gte('created_at', new Date(now.getTime() - REPEAT_WINDOW_MS).toISOString())
    .limit(1);
  const openId = openError ? null : ((open ?? [])[0]?.id as string | undefined);
  if (openId) {
    if (!requested) return { filed: true, when: null };
    const { error: moveError } = await db
      .from('todos')
      .update({ due_date: requested.at.toISOString() })
      .eq('id', openId)
      .eq('account_id', args.accountId);
    if (moveError) {
      console.error('[owner-callback] to-do reschedule failed:', moveError);
    }
    return { filed: true, when: moveError ? null : when };
  }

  const name = args.contactName?.trim() || 'A property owner';
  const about =
    args.listingTitles.length === 1
      ? ` about ${args.listingTitles[0]}`
      : ' about their listings';
  const { error: todoError } = await db.from('todos').insert({
    account_id: args.accountId,
    user_id: args.userId,
    assigned_to: args.agentUserId,
    title: `Call back ${name} (owner)${about}`,
    description: args.text.slice(0, 500),
    due_date: (
      requested?.at ?? new Date(now.getTime() + DEFAULT_DUE_MS)
    ).toISOString(),
    priority: 'high',
    completed: false,
    contact_id: args.contactId,
    source: 'system',
  });
  if (todoError) {
    console.error('[owner-callback] to-do insert failed:', todoError);
  }

  const timing = when ?? 'within the hour';
  await createNotification({
    accountId: args.accountId,
    userId: args.agentUserId,
    type: 'listing_interest',
    title: `Call back ${name} (owner) ${timing}`,
    body: `${name} (${args.contactPhone || 'no number'}) asked for a call${about}: "${args.text.slice(0, 300)}"`,
    entityType: 'conversation',
    entityId: args.conversationId,
    link: `/inbox?conversation=${args.conversationId}`,
    whatsappText: [
      '📞 *Owner asked for a call back*',
      `👤 ${name} (${args.contactPhone || 'no number'})`,
      ...args.listingTitles.slice(0, 3).map((title) => `🏠 ${title}`),
      `⏰ Call ${timing}`,
      '',
      args.text.slice(0, 300),
      '',
      BRIDGE_REPLY_HINT,
    ].join('\n'),
  });

  return { filed: !todoError, when };
}
