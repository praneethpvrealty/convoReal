import type { SupabaseClient } from '@supabase/supabase-js';
import { createNotification } from '@/lib/notifications/create';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendTextMessage } from '@/lib/whatsapp/meta-api';
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils';
import type { NumberProfileRow } from '@/lib/whatsapp/number-profiles';

export const RETIRED_REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const RETIRED_REPLY_PLACEHOLDERS = [
  '{{business_name}}',
  '{{new_number}}',
  '{{link}}',
] as const;

export interface RetiredReplyContext {
  businessName: string | null;
  newNumber: string | null;
}

export type RetiredReplyOutcome = 'live' | 'cooldown' | 'replied' | 'failed';

export interface RetiredNumberInbound {
  senderPhone: string;
  senderName?: string | null;
  messageId?: string | null;
  preview?: string | null;
}

interface RetiredReplyDeps {
  send?: typeof sendTextMessage;
  notify?: typeof createNotification;
  now?: () => Date;
}

interface LiveRow {
  phone_number_id: string | null;
  integration_type: string | null;
  display_phone_number: string | null;
  user_id: string | null;
}

export function waMeLink(displayNumber: string | null): string | null {
  const digits = normalizePhone(displayNumber);
  return digits ? `https://wa.me/${digits}` : null;
}

export function defaultRetiredNumberReply(ctx: RetiredReplyContext): string {
  const who = ctx.businessName?.trim()
    ? `${ctx.businessName.trim()} has`
    : 'We have';
  if (!ctx.newNumber) {
    return `${who} moved to a new WhatsApp number. This number is no longer monitored, so please reach us on the new number.`;
  }
  const link = waMeLink(ctx.newNumber);
  return `${who} moved to a new WhatsApp number: ${ctx.newNumber}\n\nThis number is no longer monitored. Please save the new number and message us there${link ? `: ${link}` : '.'}`;
}

export function renderRetiredNumberReply(
  message: string | null,
  ctx: RetiredReplyContext
): string {
  if (!message) return defaultRetiredNumberReply(ctx);
  const rendered = message
    .replaceAll('{{business_name}}', ctx.businessName?.trim() ?? '')
    .replaceAll('{{new_number}}', ctx.newNumber ?? '')
    .replaceAll('{{link}}', waMeLink(ctx.newNumber) ?? '')
    .trim();
  return rendered || defaultRetiredNumberReply(ctx);
}

export async function loadRetiredNumberProfile(
  db: SupabaseClient,
  phoneNumberId: string
): Promise<NumberProfileRow | null> {
  const { data, error } = await db
    .from('whatsapp_number_profiles')
    .select('*')
    .eq('phone_number_id', phoneNumberId)
    .eq('auto_reply_enabled', true)
    .maybeSingle();
  if (error) {
    console.error('[retired-number] profile lookup failed:', error);
    return null;
  }
  return (data as NumberProfileRow | null) ?? null;
}

type Claim =
  { claimed: true; release: () => Promise<void> } | { claimed: false };

async function claimRetiredReply(
  db: SupabaseClient,
  args: { accountId: string; phoneNumberId: string; senderPhone: string },
  now: Date
): Promise<Claim> {
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - RETIRED_REPLY_COOLDOWN_MS);
  const key = {
    account_id: args.accountId,
    phone_number_id: args.phoneNumberId,
    sender_phone: args.senderPhone,
  };
  const { data: inserted, error } = await db
    .from('whatsapp_retired_number_replies')
    .insert({ ...key, reply_count: 1, last_replied_at: nowIso })
    .select('id')
    .maybeSingle();
  if (!error) {
    const id = (inserted as { id: string } | null)?.id;
    return {
      claimed: true,
      release: async () => {
        if (!id) return;
        await db.from('whatsapp_retired_number_replies').delete().eq('id', id);
      },
    };
  }
  if ((error as { code?: string }).code !== '23505') throw error;

  const { data: existing, error: readError } = await db
    .from('whatsapp_retired_number_replies')
    .select('id, reply_count, last_replied_at')
    .eq('account_id', args.accountId)
    .eq('phone_number_id', args.phoneNumberId)
    .eq('sender_phone', args.senderPhone)
    .maybeSingle();
  if (readError) throw readError;
  const row = existing as {
    id: string;
    reply_count: number;
    last_replied_at: string;
  } | null;
  if (!row || new Date(row.last_replied_at) >= cutoff)
    return { claimed: false };

  const { data: updated, error: updateError } = await db
    .from('whatsapp_retired_number_replies')
    .update({ reply_count: row.reply_count + 1, last_replied_at: nowIso })
    .eq('id', row.id)
    .lt('last_replied_at', cutoff.toISOString())
    .select('id');
  if (updateError) throw updateError;
  if (!updated?.length) return { claimed: false };
  return {
    claimed: true,
    release: async () => {
      await db
        .from('whatsapp_retired_number_replies')
        .update({
          reply_count: row.reply_count,
          last_replied_at: row.last_replied_at,
        })
        .eq('id', row.id)
        .select('id');
    },
  };
}

async function mirrorToInbox(
  db: SupabaseClient,
  profile: NumberProfileRow,
  live: LiveRow | null,
  inbound: RetiredNumberInbound,
  notify: typeof createNotification
): Promise<void> {
  if (!live?.user_id) return;
  const digits = normalizePhone(inbound.senderPhone);
  const suffix = digits.length > 8 ? digits.slice(-8) : digits;
  const { data: candidates } = await db
    .from('contacts')
    .select('id, name, phone')
    .eq('account_id', profile.account_id)
    .eq('is_merged', false)
    .like('phone', `%${suffix}`)
    .limit(20);
  const contact = (
    (candidates ?? []) as Array<{
      id: string;
      name: string | null;
      phone: string | null;
    }>
  ).find((c) => c.phone && phonesMatch(c.phone, digits));
  const sender =
    contact?.name?.trim() || inbound.senderName?.trim() || `+${digits}`;
  const preview = inbound.preview?.trim() || '[non-text message]';
  await notify({
    accountId: profile.account_id,
    userId: live.user_id,
    type: 'new_message',
    title: `Message to retired number ${profile.display_phone_number ?? profile.phone_number_id}`,
    body: `${sender}: ${preview.slice(0, 200)}`,
    entityType: contact ? 'contact' : null,
    entityId: contact?.id ?? null,
    link: contact ? `/contacts/${contact.id}` : null,
    channels: { inApp: true, whatsapp: false, push: true },
  });
}

export async function replyFromRetiredNumber(
  db: SupabaseClient,
  profile: NumberProfileRow,
  inbound: RetiredNumberInbound,
  deps: RetiredReplyDeps = {}
): Promise<RetiredReplyOutcome> {
  const send = deps.send ?? sendTextMessage;
  const notify = deps.notify ?? createNotification;
  const now = deps.now ? deps.now() : new Date();

  const [{ data: liveData }, { data: account }] = await Promise.all([
    db
      .from('whatsapp_config')
      .select(
        'phone_number_id, integration_type, display_phone_number, user_id'
      )
      .eq('account_id', profile.account_id)
      .maybeSingle(),
    db
      .from('accounts')
      .select('name')
      .eq('id', profile.account_id)
      .maybeSingle(),
  ]);
  const live = (liveData as LiveRow | null) ?? null;
  if (
    live &&
    (live.integration_type || 'official_api') === 'official_api' &&
    live.phone_number_id === profile.phone_number_id
  ) {
    return 'live';
  }

  try {
    await mirrorToInbox(db, profile, live, inbound, notify);
  } catch (err) {
    console.error('[retired-number] inbox mirror failed:', err);
  }

  const senderPhone = normalizePhone(inbound.senderPhone);
  if (!senderPhone) return 'failed';

  let claim: Claim;
  try {
    claim = await claimRetiredReply(
      db,
      {
        accountId: profile.account_id,
        phoneNumberId: profile.phone_number_id,
        senderPhone,
      },
      now
    );
  } catch (err) {
    console.error('[retired-number] claim failed:', err);
    return 'failed';
  }
  if (!claim.claimed) return 'cooldown';

  const text = renderRetiredNumberReply(profile.auto_reply_message, {
    businessName: (account as { name?: string | null } | null)?.name ?? null,
    newNumber:
      live && (live.integration_type || 'official_api') === 'official_api'
        ? live.display_phone_number
        : null,
  });

  try {
    const accessToken = decrypt(profile.access_token);
    await send({
      phoneNumberId: profile.phone_number_id,
      accessToken,
      to: senderPhone,
      text,
      contextMessageId: inbound.messageId ?? undefined,
    });
    return 'replied';
  } catch (err) {
    console.error('[retired-number] reply failed:', err);
    await claim.release().catch(() => undefined);
    return 'failed';
  }
}
