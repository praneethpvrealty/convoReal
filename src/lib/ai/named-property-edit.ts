import type { SupabaseClient } from '@supabase/supabase-js';
import { formatInrPlain } from '@/lib/format/currency';
import { sanitizeFloorTenancies } from '@/lib/inventory/floor-tenancies';
import { isMonthlyPricedListing } from '@/lib/inventory/rental-yield';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  resolveBotTarget,
  type BotTarget,
} from '@/lib/whatsapp/bot-message-target';

const CODE = String.raw`prop[-\s]?\d{1,7}`;
const VERB = String.raw`(?:update|change|edit|modify|correct|revise|amend|set|fix|mark)`;
const FIELD = String.raw`(?:rent\w*|pric\w*|rate|cost|status|title|name|description|details?|info\w*|area|size|sq\.?\s?ft|bed\w*|bhk|bath\w*|location|address|locality|facing|tenan\w*|lease\w*|lock-?in|maintenance|advance|deposit|gst|listing|property)`;
const FILLER = String.raw`[\w\s,'’&/-]`;
const NOUN = String.raw`(?:(?:the|my|this|our)\s+)?(?:(?:property|listing)\s+)?`;

const VERB_THEN_CODE = new RegExp(
  String.raw`\b${VERB}\s+${NOUN}(?:code\s+)?${CODE}\b`,
  'i'
);
const VERB_FIELD_OF_CODE = new RegExp(
  String.raw`\b${VERB}\b${FILLER}{0,60}?\b${FIELD}\b${FILLER}{0,40}?\b(?:of|for|in|on)\s+${NOUN}(?:code\s+)?${CODE}\b`,
  'i'
);

export const NAMED_EDIT_PROMPT = /^✏️ \*What should change on /;
export const NAMED_EDIT_ANSWER_WINDOW_MS = 15 * 60 * 1000;
export const NAMED_EDIT_ANSWER_MAX_CHARS = 500;

export function propertyCodesIn(text: string | null | undefined): Set<string> {
  return new Set(
    Array.from(
      (text || '').matchAll(new RegExp(String.raw`\b${CODE}\b`, 'gi')),
      (m) => m[0].replace(/\D/g, '')
    )
  );
}

export function parseNamedPropertyEdit(
  text: string | null | undefined
): string | null {
  const value = (text || '').trim();
  if (!value) return null;
  const codes = propertyCodesIn(value);
  if (codes.size !== 1) return null;
  if (!VERB_THEN_CODE.test(value) && !VERB_FIELD_OF_CODE.test(value)) {
    return null;
  }
  return `PROP-${Array.from(codes)[0]}`;
}

export interface NamedPropertyRow {
  id: string;
  title: string | null;
  property_code: string | null;
  listing_type: string | null;
  status: string | null;
  price: number | null;
  rental_income: number | null;
  maintenance: number | null;
  advance: number | null;
  gst: number | null;
  floor_tenancies: unknown;
}

export async function findPropertyByCode(params: {
  accountId: string;
  code: string;
  client?: SupabaseClient;
}): Promise<NamedPropertyRow | null | undefined> {
  const db = params.client || supabaseAdmin();
  const digits = params.code.replace(/\D/g, '');
  const { data, error } = await db
    .from('properties')
    .select(
      'id, title, property_code, listing_type, status, price, rental_income, maintenance, advance, gst, floor_tenancies'
    )
    .eq('account_id', params.accountId)
    .in('property_code', [`PROP-${digits}`, `PROP${digits}`])
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[named-property-edit] lookup failed:', error);
    return undefined;
  }
  return (data as NamedPropertyRow | null) ?? null;
}

function money(value: number | null, suffix = ''): string {
  return value ? `${formatInrPlain(value)}${suffix}` : '_Not set_';
}

export function formatNamedEditPrompt(property: NamedPropertyRow): string {
  const code = property.property_code || 'this listing';
  const monthly = isMonthlyPricedListing(property.listing_type);
  const tenancies = sanitizeFloorTenancies(property.floor_tenancies);
  const lines = [
    `✏️ *What should change on ${code}?*`,
    property.title ? `_${property.title}_` : null,
    '',
    `• Status: ${property.status || '_Not set_'}`,
    monthly
      ? `• Rent: ${money(property.price, '/month')}`
      : `• Price: ${money(property.price)}`,
    monthly
      ? null
      : `• Rental income: ${money(property.rental_income, '/month')}`,
    `• Maintenance: ${money(property.maintenance, '/month')}`,
    `• Advance: ${money(property.advance)}`,
    `• GST: ${
      property.gst
        ? property.gst <= 100
          ? `${property.gst}%`
          : formatInrPlain(property.gst)
        : '_Not set_'
    }`,
    monthly
      ? null
      : `• Floor-wise leases: ${tenancies.length || '_None recorded_'}`,
    '',
    '_Send the new details in your next message, e.g. "rent 45,000, advance 3 lakh"._',
  ];
  return lines.filter((line) => line !== null).join('\n');
}

export function formatNamedEditNotFound(code: string): string {
  return `⚠️ I couldn't find a listing with code *${code}*. Please check the code and send it again.`;
}

export async function pendingNamedEditTarget(params: {
  accountId: string;
  conversationId: string;
  text: string;
  now?: number;
  client?: SupabaseClient;
}): Promise<BotTarget | null> {
  if (params.text.length > NAMED_EDIT_ANSWER_MAX_CHARS) return null;
  try {
    const db = params.client || supabaseAdmin();
    const { data, error } = await db
      .from('messages')
      .select('message_id, content_text, created_at')
      .eq('conversation_id', params.conversationId)
      .eq('sender_type', 'bot')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const asked = (data.content_text as string) || '';
    if (!NAMED_EDIT_PROMPT.test(asked)) return null;
    const askedCodes = propertyCodesIn(asked.split('\n')[0]);
    for (const code of propertyCodesIn(params.text)) {
      if (!askedCodes.has(code)) return null;
    }
    const askedAt = new Date(data.created_at as string).getTime();
    if ((params.now ?? Date.now()) - askedAt > NAMED_EDIT_ANSWER_WINDOW_MS) {
      return null;
    }
    const target = await resolveBotTarget({
      accountId: params.accountId,
      contextId: data.message_id as string | null,
      client: db,
    });
    return target?.entityType === 'property' ? target : null;
  } catch (err) {
    console.error('[named-property-edit] pending lookup threw:', err);
    return null;
  }
}
