import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_LANGUAGE,
  isLanguageCode,
  languageForMetaCode,
  type LanguageCode,
} from '@/lib/languages';
import { accountBrandName } from '@/lib/showcase/account-showcase-url';
import { portalInviteSenderLabel } from '@/lib/whatsapp/portal-invite-template';

export interface MessageSender {
  agentName: string | null;
  brandName: string | null;
}

const clean = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

async function memberName(
  db: SupabaseClient,
  accountId: string,
  userId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('profiles')
    .select('full_name')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[message-sender] member lookup failed:', error.message);
    return null;
  }
  return clean((data as { full_name?: unknown } | null)?.full_name);
}

async function ownerName(
  db: SupabaseClient,
  accountId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('profiles')
    .select('full_name')
    .eq('account_id', accountId)
    .eq('account_role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[message-sender] owner lookup failed:', error.message);
    return null;
  }
  return clean((data as { full_name?: unknown } | null)?.full_name);
}

export async function resolveMessageAgentName(
  db: SupabaseClient,
  accountId: string,
  userIds: ReadonlyArray<string | null | undefined>
): Promise<string | null> {
  try {
    for (const userId of new Set(userIds.filter(Boolean) as string[])) {
      const name = await memberName(db, accountId, userId);
      if (name) return name;
    }
    return await ownerName(db, accountId);
  } catch (err) {
    console.error('[message-sender] agent lookup threw:', err);
    return null;
  }
}

export async function resolveMessageSender(
  db: SupabaseClient,
  accountId: string,
  userIds: ReadonlyArray<string | null | undefined>,
  brandName?: string | null
): Promise<MessageSender> {
  const [agentName, brand] = await Promise.all([
    resolveMessageAgentName(db, accountId, userIds),
    brandName === undefined
      ? accountBrandName(db, accountId)
      : Promise.resolve(brandName),
  ]);
  return { agentName, brandName: clean(brand) };
}

function labelLanguage(language: string | null | undefined): LanguageCode {
  const raw = language?.trim() ?? '';
  if (isLanguageCode(raw)) return raw;
  return (raw && languageForMetaCode(raw)) || DEFAULT_LANGUAGE;
}

export function messageSenderLabel(
  sender: MessageSender | null | undefined,
  language?: string | null
): string {
  return portalInviteSenderLabel(
    sender?.agentName,
    sender?.brandName,
    labelLanguage(language)
  );
}
