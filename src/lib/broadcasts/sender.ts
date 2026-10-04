import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder';
import { greetingName } from '@/lib/contacts/lead-placeholder';
import { ENQUIRY_NOTICE_TEMPLATE_NAMES } from '@/lib/whatsapp/enquiry-notice-template';
import { resolveLanguage } from '@/lib/whatsapp/template-language';
import { metaLanguageCode } from '@/lib/languages';
import { csvPhoneDigits } from '@/lib/broadcasts/csv-audience';
import { DEFAULT_COUNTRY_CODE } from '@/lib/whatsapp/phone-utils';
import {
  loadEnquiryNoticeContext,
  resolveEnquiryNoticeParams,
  ENQUIRY_NOTICE_FAILURE_REASONS,
} from './enquiry-notice-params';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';

export interface CustomFieldFilter {
  fieldId: string;
  operator: 'is' | 'is_not' | 'contains';
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'contacts' | 'custom_field' | 'csv';
  tagIds?: string[];
  contactIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  excludeTagIds?: string[];
}

export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(errorMsg: string): boolean {
  return (
    errorMsg.includes('130429') ||
    errorMsg.includes('131056') ||
    errorMsg.toLowerCase().includes('rate limit') ||
    errorMsg.toLowerCase().includes('too many requests')
  );
}

function resolveTemplateBodyText(bodyTemplateText: string, params: string[]) {
  return bodyTemplateText.replace(/\{\{(\d+)\}\}/g, (match, numberStr) => {
    const idx = parseInt(numberStr) - 1;
    return idx >= 0 && idx < params.length ? params[idx] : match;
  });
}

export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>
): string[] {
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      // Meta rejects empty body params, failing that recipient's send —
      // a missing or placeholder name ("Housing Lead") resolves to a
      // greetable fallback instead.
      const fieldMap: Record<string, string | null | undefined> = {
        name: greetingName(contact.name),
        phone: contact.phone ?? undefined,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    // custom_field
    return customValues?.get(v.value) ?? '';
  });
}

const PAGE_SIZE = 1000;
const ID_CHUNK = 200;
const PHONE_CHUNK = 100;
const AUDIENCE_ID_CHUNK = 1000;

interface PageResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

async function readPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult>,
  what: string
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch ${what}: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function contactsByIds<T>(
  supabase: SupabaseClient,
  accountId: string,
  ids: readonly string[],
  columns: string
): Promise<T[]> {
  const rows: T[] = [];
  for (const idChunk of chunk([...new Set(ids)], ID_CHUNK)) {
    const { data, error } = await supabase
      .from('contacts')
      .select(columns)
      .eq('account_id', accountId)
      .in('id', idChunk);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    rows.push(...((data ?? []) as unknown as T[]));
  }
  return rows;
}

function audienceArgs(
  accountId: string,
  audience: AudienceConfig,
  optedInOnly: boolean
) {
  return {
    p_account_id: accountId,
    p_type: audience.type,
    p_tag_ids: audience.tagIds ?? null,
    p_contact_ids: audience.contactIds ?? null,
    p_field_id: audience.customField?.fieldId ?? null,
    p_field_operator: audience.customField?.operator ?? null,
    p_field_value: audience.customField?.value ?? null,
    p_exclude_tag_ids: audience.excludeTagIds ?? null,
    p_opted_in_only: optedInOnly,
  };
}

async function audienceContactIds(
  supabase: SupabaseClient,
  accountId: string,
  audience: AudienceConfig,
  optedInOnly: boolean
): Promise<string[]> {
  const rows = await readPages<{ contact_id: string }>(
    (from, to) =>
      supabase
        .rpc(
          'broadcast_audience_contact_ids',
          audienceArgs(accountId, audience, optedInOnly)
        )
        .order('contact_id')
        .range(from, to),
    'broadcast audience'
  );
  return rows.map((r) => r.contact_id);
}

function csvPhoneKey(phone: string): string {
  return csvPhoneDigits(phone, DEFAULT_COUNTRY_CODE);
}

function storedPhoneDigits(key: string): string[] {
  const local = key.slice(-10);
  return key.length > 10 && csvPhoneKey(local) === key
    ? [key, `00${key}`, local, `0${local}`]
    : [key, `00${key}`];
}

type CsvRow = { phone: string; name?: string };

interface CsvMatch {
  rowsByKey: Map<string, CsvRow>;
  idsByKey: Map<string, string[]>;
  missing: CsvRow[];
}

interface PhoneMatch {
  id: string;
  phone: string | null;
  is_merged?: boolean | null;
}

function addContactToKey(
  idsByKey: Map<string, string[]>,
  rowsByKey: Map<string, CsvRow>,
  contact: PhoneMatch
) {
  const key = contact.phone ? csvPhoneKey(contact.phone) : '';
  if (!rowsByKey.has(key)) return;
  const ids = idsByKey.get(key) ?? [];
  if (ids.includes(contact.id)) return;
  idsByKey.set(
    key,
    contact.is_merged ? [...ids, contact.id] : [contact.id, ...ids]
  );
}

async function matchCsvContacts(
  supabase: SupabaseClient,
  accountId: string,
  csvRows: readonly CsvRow[]
): Promise<CsvMatch> {
  const rowsByKey = new Map<string, CsvRow>();
  for (const row of csvRows) {
    const key = row.phone ? csvPhoneKey(row.phone) : '';
    if (key && !rowsByKey.has(key)) rowsByKey.set(key, row);
  }

  const idsByKey = new Map<string, string[]>();
  for (const keys of chunk([...rowsByKey.keys()], PHONE_CHUNK)) {
    const digits = [...new Set(keys.flatMap(storedPhoneDigits))];
    const matches = await readPages<PhoneMatch>(
      (from, to) =>
        supabase
          .rpc('contacts_matching_phone_digits', {
            p_account_id: accountId,
            p_digits: digits,
          })
          .order('id')
          .range(from, to),
      'CSV contacts'
    );
    for (const contact of matches) {
      addContactToKey(idsByKey, rowsByKey, contact);
    }
  }

  const missing = [...rowsByKey]
    .filter(([key]) => !idsByKey.has(key))
    .map(([, row]) => row);
  return { rowsByKey, idsByKey, missing };
}

async function csvRecipientIds(
  supabase: SupabaseClient,
  accountId: string,
  idsByKey: Map<string, string[]>,
  excludeTagIds: string[] | undefined,
  optedInOnly: boolean
): Promise<string[]> {
  const passing = new Set<string>();
  const ids = [...new Set([...idsByKey.values()].flat())];
  for (const contactIds of chunk(ids, AUDIENCE_ID_CHUNK)) {
    const recipients = await audienceContactIds(
      supabase,
      accountId,
      { type: 'contacts', contactIds, excludeTagIds },
      optedInOnly
    );
    for (const id of recipients) passing.add(id);
  }
  return [...idsByKey.values()]
    .filter((keyIds) => keyIds.every((id) => passing.has(id)))
    .map((keyIds) => keyIds[0]);
}

async function insertCsvContacts(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  match: CsvMatch
): Promise<void> {
  for (const rows of chunk(match.missing, ID_CHUNK)) {
    const { data: inserted, error: insertErr } = await supabase
      .from('contacts')
      .insert(
        rows.map((row) => ({
          user_id: userId,
          account_id: accountId,
          phone: `+${csvPhoneKey(row.phone)}`,
          name: row.name ?? null,
        }))
      )
      .select('id, phone');
    if (insertErr) {
      throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
    }
    for (const contact of (inserted ?? []) as PhoneMatch[]) {
      addContactToKey(match.idsByKey, match.rowsByKey, contact);
    }
  }
}

export async function resolveAudienceOnServer(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  audience: AudienceConfig,
  { optedInOnly = false }: { optedInOnly?: boolean } = {}
): Promise<Contact[]> {
  let ids: string[];
  if (audience.type === 'csv') {
    const match = await matchCsvContacts(
      supabase,
      accountId,
      audience.csvContacts ?? []
    );
    await insertCsvContacts(supabase, accountId, userId, match);
    ids = await csvRecipientIds(
      supabase,
      accountId,
      match.idsByKey,
      audience.excludeTagIds,
      optedInOnly
    );
  } else {
    ids = await audienceContactIds(supabase, accountId, audience, optedInOnly);
  }
  return contactsByIds<Contact>(supabase, accountId, ids, '*');
}

export async function countAudienceOnServer(
  supabase: SupabaseClient,
  accountId: string,
  audience: AudienceConfig,
  { optedInOnly = false }: { optedInOnly?: boolean } = {}
): Promise<number> {
  if (audience.type === 'csv') {
    const match = await matchCsvContacts(
      supabase,
      accountId,
      audience.csvContacts ?? []
    );
    const existing = await csvRecipientIds(
      supabase,
      accountId,
      match.idsByKey,
      audience.excludeTagIds,
      optedInOnly
    );
    return existing.length + (optedInOnly ? 0 : match.missing.length);
  }

  const { data, error } = await supabase.rpc(
    'count_broadcast_audience',
    audienceArgs(accountId, audience, optedInOnly)
  );
  if (error) {
    throw new Error(`Failed to count broadcast audience: ${error.message}`);
  }
  return Number(data ?? 0);
}

export async function sendBroadcastRecipients(
  broadcastId: string,
  accountId: string,
  userId: string,
  limit: number = 200
) {
  const supabase = supabaseAdmin(); // Use admin/service role client to bypass user RLS constraints on updates

  // Fetch the broadcast details
  const { data: broadcast, error: bErr } = await supabase
    .from('broadcasts')
    .select('*')
    .eq('id', broadcastId)
    .single();

  if (bErr || !broadcast || broadcast.status !== 'sending') {
    return;
  }

  // Only one dispatcher may send a broadcast at a time. Recipients are
  // selected as 'pending' and only marked sent afterwards, so nothing
  // stops two concurrent runners reading the same set and both sending
  // — and there ARE two: the fire-and-forget promise that starts the
  // broadcast, and the sweep cron that rescues stalled ones, which
  // fires every 5 minutes into a dispatch paced at one send per second.
  // Losing the race means returning empty-handed, never sending.
  const { data: claimed, error: claimErr } = await supabase.rpc(
    'claim_broadcast_dispatch',
    { p_broadcast_id: broadcastId, p_lease_seconds: DISPATCH_LEASE_SECONDS }
  );
  if (claimErr) {
    console.error(
      `[Broadcast Sender] Could not claim dispatch for ${broadcastId}:`,
      claimErr.message
    );
    return;
  }
  if (claimed !== true) {
    console.log(
      `[Broadcast Sender] ${broadcastId} already being dispatched elsewhere — standing down.`
    );
    return;
  }

  try {
    await dispatchClaimedRecipients(
      broadcast,
      broadcastId,
      accountId,
      userId,
      limit
    );
  } finally {
    // Freed immediately so a retry sweep can pick up anything left
    // behind rather than waiting out the lease.
    await supabase
      .rpc('release_broadcast_dispatch', { p_broadcast_id: broadcastId })
      .then(undefined, (err: unknown) => {
        console.error('[Broadcast Sender] lease release failed:', err);
      });
  }
}

/** How long a dispatcher's claim survives without renewal. Long enough
 *  to outlast a batch of sends, short enough that a dispatcher killed
 *  mid-flight is taken over by the next sweep rather than stranding the
 *  broadcast. */
const DISPATCH_LEASE_SECONDS = 120;

async function dispatchClaimedRecipients(
  broadcast: {
    template_name: string;
    template_language?: string | null;
    template_variables?: Record<string, VariableMapping> | null;
    header_media_url?: string | null;
  },
  broadcastId: string,
  accountId: string,
  userId: string,
  limit: number
) {
  const supabase = supabaseAdmin();

  // Claiming IS the permission to send. Reading rows that are merely
  // 'pending' and sending to them lets any second sender — whatever it
  // is, wherever it starts — send the same message again; a real batch
  // produced two sends 2ms apart that way. This UPDATE returns only the
  // rows this caller moved out of 'pending', so a racing sender gets an
  // empty list instead of a duplicate.
  const { data: claimedRows, error: rFetchErr } = await supabase.rpc(
    'claim_broadcast_recipients',
    { p_broadcast_id: broadcastId, p_limit: limit }
  );

  if (rFetchErr) {
    console.error(
      `[Broadcast Sender] Error claiming recipients for ${broadcastId}:`,
      rFetchErr.message
    );
    return;
  }

  // The claim returns the row only; contacts are loaded separately
  // because an UPDATE ... RETURNING cannot embed a related table.
  type ClaimedRecipient = Record<string, unknown> & {
    id: string;
    contact_id: string;
    retry_count?: number | null;
    contact?: Contact;
  };
  const claimed = (claimedRows ?? []) as ClaimedRecipient[];
  let recipients: ClaimedRecipient[] = [];
  if (claimed.length > 0) {
    const { data: contactRows } = await supabase
      .from('contacts')
      .select('*')
      .eq('account_id', accountId)
      .in('id', [...new Set(claimed.map((r) => r.contact_id))]);
    const contactById = new Map(
      ((contactRows ?? []) as Contact[]).map((c) => [c.id, c])
    );
    recipients = claimed.map((r) => ({
      ...r,
      contact: contactById.get(r.contact_id),
    }));
  }

  if (recipients.length === 0) {
    // Nothing claimable. Either another sender holds every remaining
    // row, or the broadcast is genuinely finished — only the latter
    // may close it out.
    const { data: outstanding, error: countErr } = await supabase.rpc(
      'broadcast_outstanding_count',
      { p_broadcast_id: broadcastId }
    );
    const count = typeof outstanding === 'number' ? outstanding : null;

    if (!countErr && count === 0) {
      const { data: summary } = await supabase
        .from('broadcast_recipients')
        .select('status')
        .eq('broadcast_id', broadcastId);

      const allFailed =
        summary &&
        summary.length > 0 &&
        summary.every((r) => r.status === 'failed');
      await supabase
        .from('broadcasts')
        .update({
          status: allFailed ? 'failed' : 'sent',
          updated_at: new Date().toISOString(),
        })
        .eq('id', broadcastId);
    }
    return;
  }

  // Fetch the template details
  let templateRow = null;
  const { data: tData } = await supabase
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', broadcast.template_name)
    .eq('language', broadcast.template_language || 'en_US')
    .limit(1);

  if (tData && tData.length > 0) {
    templateRow = tData[0];
  } else {
    // Fallback: search by name only
    const { data: tFallback } = await supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', broadcast.template_name)
      .limit(1);
    if (tFallback && tFallback.length > 0) {
      templateRow = tFallback[0];
    }
  }

  // Every approved language variant of the same template name, so one
  // broadcast can reach a Tamil contact in Tamil and a Hindi one in
  // Hindi. The row the agent chose in the wizard stays the baseline:
  // a recipient with no language of their own, or one whose language
  // has no approved variant, gets exactly that row and nothing about
  // this broadcast changes.
  const variantByLanguage = new Map<string, Record<string, unknown>>();
  const { data: variantRows } = await supabase
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', broadcast.template_name);
  for (const row of (variantRows ?? []) as Record<string, unknown>[]) {
    const lang = typeof row.language === 'string' ? row.language : '';
    if (!lang) continue;
    if (String(row.status ?? '').toUpperCase() !== 'APPROVED') continue;
    if (!variantByLanguage.has(lang)) variantByLanguage.set(lang, row);
  }

  const { data: accountRow } = await supabase
    .from('accounts')
    .select('default_language')
    .eq('id', accountId)
    .maybeSingle();
  const accountLanguage = (
    accountRow as { default_language?: string | null } | null
  )?.default_language;

  // Pre-load custom contact values for the batch
  const contactIds = recipients
    .map((r) => r.contact_id)
    .filter((id): id is string => Boolean(id));
  const customValueIndex = new Map<string, Map<string, string>>();
  if (contactIds.length > 0) {
    const { data: cvRows } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', contactIds);

    for (const row of cvRows ?? []) {
      const bucket =
        customValueIndex.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      customValueIndex.set(row.contact_id, bucket);
    }
  }

  // Loaded once per sweep for the property-anchored template only —
  // every other template resolves its params from the contact row.
  const enquiryNoticeContext = ENQUIRY_NOTICE_TEMPLATE_NAMES.includes(
    broadcast.template_name ?? ''
  )
    ? await loadEnquiryNoticeContext(
        supabase,
        accountId,
        recipients
          .map((r) => r.contact)
          .filter((c): c is Contact => Boolean(c?.id)),
        broadcast.template_name ?? undefined
      )
    : null;

  const BATCH_SIZE = 10;
  const DELAY_MS = 1000;
  const MAX_RETRIES = 5;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    // A long batch outlives the lease at one send per second, so renew
    // per chunk — otherwise a sweep would rightly conclude this
    // dispatcher had died and start a second one over the same rows.
    await supabase
      .rpc('renew_broadcast_dispatch', {
        p_broadcast_id: broadcastId,
        p_lease_seconds: DISPATCH_LEASE_SECONDS,
      })
      .then(undefined, (err: unknown) => {
        console.error('[Broadcast Sender] lease renewal failed:', err);
      });

    // The row claims need the same heartbeat, and only had the
    // broadcast lease renewed. On batch 5 a dispatcher held 50 rows,
    // was still working 17 minutes later, and the sweep reclaimed the
    // 16 it had not reached because their claims had gone stale —
    // 8 leads were messaged twice. Renew the rows still outstanding,
    // bounded by the slice this dispatcher actually claimed.
    const outstanding = recipients.slice(i).map((r) => r.id);
    if (outstanding.length > 0) {
      await supabase
        .rpc('renew_broadcast_recipient_claims', { p_ids: outstanding })
        .then(undefined, (err: unknown) => {
          console.error('[Broadcast Sender] claim renewal failed:', err);
        });
    }

    const batch = recipients.slice(i, i + BATCH_SIZE);

    for (const recipient of batch) {
      if (!recipient.contact?.phone) {
        await supabase
          .from('broadcast_recipients')
          .update({
            status: 'failed',
            error_message: 'No phone number on contact',
          })
          .eq('id', recipient.id);
        continue;
      }

      // A contact can opt out (STOP ALERTS / portal) after the
      // broadcast was queued — re-check at send time.
      if (recipient.contact.buyer_alerts_consent === 'declined') {
        await supabase
          .from('broadcast_recipients')
          .update({
            status: 'failed',
            error_message: 'Contact opted out of WhatsApp alerts (STOP ALERTS)',
          })
          .eq('id', recipient.id);
        continue;
      }

      // The property-anchored template's params come from two other
      // tables, not from columns on the contact — and a recipient
      // missing either property must not be sent a message with a
      // hole in it.
      let bodyParams: string[];
      if (enquiryNoticeContext) {
        const resolved = resolveEnquiryNoticeParams(
          recipient.contact,
          enquiryNoticeContext
        );
        if ('failure' in resolved) {
          await supabase
            .from('broadcast_recipients')
            .update({
              status: 'failed',
              error_message: ENQUIRY_NOTICE_FAILURE_REASONS[resolved.failure],
            })
            .eq('id', recipient.id);
          continue;
        }
        bodyParams = resolved.params;
      } else {
        bodyParams = resolveVariables(
          broadcast.template_variables || {},
          recipient.contact,
          customValueIndex.get(recipient.contact.id)
        );
      }

      // Same template name, this recipient's language where we hold an
      // approved variant for it. Falls back to the agent's chosen row.
      const recipientTemplate =
        (variantByLanguage.get(
          metaLanguageCode(
            resolveLanguage(
              recipient.contact.preferred_language,
              accountLanguage
            )
          )
        ) as typeof templateRow) ?? templateRow;

      let truncatedParams = bodyParams;
      if (recipientTemplate?.body_text) {
        truncatedParams = truncateParametersToBudget(
          recipientTemplate.body_text,
          bodyParams
        );
      }

      const resolvedText = recipientTemplate?.body_text
        ? resolveTemplateBodyText(recipientTemplate.body_text, truncatedParams)
        : `[Template: ${broadcast.template_name}]`;

      const newCount = (recipient.retry_count ?? 0) + 1;

      try {
        const result = await sendWhatsAppMessageAndPersist({
          accountId,
          userId,
          toPhone: recipient.contact.phone,
          kind: 'template',
          senderType: 'agent',
          templateName: broadcast.template_name,
          templateLanguage:
            recipientTemplate?.language ||
            broadcast.template_language ||
            'en_US',
          templateParams: truncatedParams,
          messageParams: broadcast.header_media_url
            ? {
                body: truncatedParams,
                headerMediaUrl: broadcast.header_media_url,
              }
            : undefined,
          templateRow: recipientTemplate ?? undefined,
          text: resolvedText,
          customDbClient: supabase,
        });

        if (result.success && result.whatsappMessageId) {
          await supabase
            .from('broadcast_recipients')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              whatsapp_message_id: result.whatsappMessageId,
              error_message: null,
              retry_count: newCount,
            })
            .eq('id', recipient.id);
        } else {
          const errMsg = result.error || 'Unknown error';
          const rateLimited = isRateLimitError(errMsg);
          const backoffMs = Math.min(300_000, 1000 * Math.pow(2, newCount)); // cap 5m
          const retryAfter =
            rateLimited && newCount < MAX_RETRIES
              ? new Date(Date.now() + backoffMs).toISOString()
              : null;

          await supabase
            .from('broadcast_recipients')
            .update({
              status:
                rateLimited && newCount < MAX_RETRIES
                  ? 'rate_limited'
                  : 'failed',
              retry_count: newCount,
              retry_after: retryAfter,
              error_message: errMsg,
            })
            .eq('id', recipient.id);
        }
      } catch (err: unknown) {
        const errMsg =
          err instanceof Error ? err.message : 'Internal Send Error';
        await supabase
          .from('broadcast_recipients')
          .update({
            status: 'failed',
            retry_count: newCount,
            retry_after: null,
            error_message: errMsg,
          })
          .eq('id', recipient.id);
      }
    }

    if (i + BATCH_SIZE < recipients.length) {
      await sleep(DELAY_MS);
    }
  }
}

export async function sweepAndSendBroadcasts() {
  const supabase = supabaseAdmin();

  // Find all active broadcasts currently in 'sending' status
  const { data: activeBroadcasts } = await supabase
    .from('broadcasts')
    .select('id, user_id, account_id')
    .eq('status', 'sending');

  if (!activeBroadcasts || activeBroadcasts.length === 0) return;

  const startTime = Date.now();
  // Limit to 45 seconds total duration per cron sweep to prevent gateway timeout
  const maxDuration = 45000;

  for (const b of activeBroadcasts) {
    if (Date.now() - startTime > maxDuration) {
      console.log('[Broadcast Sweep] Nearing timeout limit. Halting sweep.');
      break;
    }

    // Process a batch of up to 50 recipients per sweep tick
    await sendBroadcastRecipients(b.id, b.account_id, b.user_id, 50);
  }
}
