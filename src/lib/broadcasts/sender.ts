import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder';
import { greetingName } from '@/lib/contacts/lead-placeholder';
import { isContactReachable } from '@/lib/contacts/lifecycle';
import { ENQUIRY_NOTICE_TEMPLATE_NAMES } from '@/lib/whatsapp/enquiry-notice-template';
import { resolveLanguage } from '@/lib/whatsapp/template-language';
import { metaLanguageCode } from '@/lib/languages';
import {
  loadEnquiryNoticeContext,
  resolveEnquiryNoticeParams,
  ENQUIRY_NOTICE_FAILURE_REASONS,
} from './enquiry-notice-params';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import { hasPhone } from '@/lib/contacts/reachability';

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
      const fieldMap: Record<string, string | undefined> = {
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

type AudienceCandidate = Pick<
  Contact,
  | 'id'
  | 'phone'
  | 'buyer_alerts_consent'
  | 'chain_only'
  | 'is_dead'
  | 'is_archived'
>;

const AUDIENCE_COLUMNS =
  'id, phone, buyer_alerts_consent, chain_only, is_dead, is_archived';

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

async function contactIdsWithTags(
  supabase: SupabaseClient,
  tagIds: readonly string[]
): Promise<string[]> {
  const rows = await readPages<{ contact_id: string }>(
    (from, to) =>
      supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', [...tagIds])
        .order('contact_id')
        .order('tag_id')
        .range(from, to),
    'contact tags'
  );
  return [...new Set(rows.map((r) => r.contact_id))];
}

async function contactIdsWithCustomField(
  supabase: SupabaseClient,
  { fieldId, operator, value }: CustomFieldFilter
): Promise<string[]> {
  const rows = await readPages<{ contact_id: string }>((from, to) => {
    let query = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);
    if (operator === 'is') query = query.eq('value', value);
    else if (operator === 'is_not') query = query.neq('value', value);
    else if (operator === 'contains')
      query = query.ilike('value', `%${value}%`);
    return query.order('contact_id').range(from, to);
  }, 'custom-field matches');
  return [...new Set(rows.map((r) => r.contact_id))];
}

function phoneKey(phone: string): string {
  return phone.replace(/\D/g, '');
}

async function matchCsvContacts<T extends { id: string; phone: string | null }>(
  supabase: SupabaseClient,
  accountId: string,
  csvRows: readonly { phone: string; name?: string }[],
  columns: string
): Promise<{ matched: T[]; missing: { phone: string; name?: string }[] }> {
  const uniqueByKey = new Map<string, { phone: string; name?: string }>();
  for (const row of csvRows) {
    const key = row.phone ? phoneKey(row.phone) : '';
    if (key && !uniqueByKey.has(key)) uniqueByKey.set(key, row);
  }

  const byKey = new Map<string, T>();
  for (const keys of chunk([...uniqueByKey.keys()], PHONE_CHUNK)) {
    const variants = [
      ...new Set(
        keys.flatMap((key) => [key, `+${key}`, uniqueByKey.get(key)!.phone])
      ),
    ];
    const { data, error } = await supabase
      .from('contacts')
      .select(columns)
      .eq('account_id', accountId)
      .in('phone', variants);
    if (error) {
      throw new Error(`Failed to look up CSV contacts: ${error.message}`);
    }
    for (const c of (data ?? []) as unknown as T[]) {
      const key = c.phone ? phoneKey(c.phone) : '';
      if (key && !byKey.has(key)) byKey.set(key, c);
    }
  }

  const matched = new Map<string, T>();
  const missing: { phone: string; name?: string }[] = [];
  for (const [key, row] of uniqueByKey) {
    const existing = byKey.get(key);
    if (existing) matched.set(existing.id, existing);
    else missing.push(row);
  }
  return { matched: [...matched.values()], missing };
}

async function upsertCsvContactsOnServer(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  csvRows: { phone: string; name?: string }[]
): Promise<Contact[]> {
  if (csvRows.length === 0) return [];

  const { matched, missing } = await matchCsvContacts<Contact>(
    supabase,
    accountId,
    csvRows,
    '*'
  );

  const contacts = [...matched];
  for (const rows of chunk(missing, ID_CHUNK)) {
    const { data: inserted, error: insertErr } = await supabase
      .from('contacts')
      .insert(
        rows.map((row) => ({
          user_id: userId,
          account_id: accountId,
          phone: row.phone,
          name: row.name ?? null,
        }))
      )
      .select();
    if (insertErr) {
      throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
    }
    contacts.push(...((inserted ?? []) as Contact[]));
  }
  return contacts;
}

export function isBroadcastRecipient(
  contact: Omit<AudienceCandidate, 'id'>
): boolean {
  return (
    hasPhone(contact) &&
    contact.buyer_alerts_consent !== 'declined' &&
    !contact.chain_only &&
    isContactReachable(contact)
  );
}

export function onlyOptedIn<T extends Pick<Contact, 'buyer_alerts_consent'>>(
  contacts: T[]
): T[] {
  return contacts.filter((c) => c.buyer_alerts_consent === 'granted');
}

async function loadAudience<T extends AudienceCandidate>(
  supabase: SupabaseClient,
  accountId: string,
  audience: AudienceConfig,
  columns: string,
  loadCsv: (rows: { phone: string; name?: string }[]) => Promise<T[]>
): Promise<T[]> {
  let contacts: T[] = [];

  if (audience.type === 'all') {
    contacts = await readPages<T>(
      (from, to) =>
        supabase
          .from('contacts')
          .select(columns)
          .eq('account_id', accountId)
          .order('id')
          .range(from, to),
      'contacts'
    );
  } else if (audience.type === 'contacts' && audience.contactIds?.length) {
    contacts = await contactsByIds<T>(
      supabase,
      accountId,
      audience.contactIds,
      columns
    );
  } else if (audience.type === 'tags' && audience.tagIds?.length) {
    contacts = await contactsByIds<T>(
      supabase,
      accountId,
      await contactIdsWithTags(supabase, audience.tagIds),
      columns
    );
  } else if (audience.type === 'custom_field' && audience.customField) {
    contacts = await contactsByIds<T>(
      supabase,
      accountId,
      await contactIdsWithCustomField(supabase, audience.customField),
      columns
    );
  } else if (audience.type === 'csv' && audience.csvContacts?.length) {
    contacts = await loadCsv(audience.csvContacts);
  }

  if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
    const excludedIds = new Set(
      await contactIdsWithTags(supabase, audience.excludeTagIds)
    );
    contacts = contacts.filter((c) => !excludedIds.has(c.id));
  }

  // Respect the buyer's WhatsApp alert opt-out (STOP ALERTS / portal
  // settings, migration 160) — declined contacts never enter the
  // audience, regardless of how it was built. Chain-only contacts drop
  // out on the same principle: they are a co-broker's downstream party,
  // carried so the consent walk can reach them and for nothing else.
  // Dead and archived contacts drop out on the same principle
  // (migration 229). Email-only contacts (migration 253) have no
  // WhatsApp number at all, so they cannot be an audience for a
  // WhatsApp broadcast.
  return contacts.filter(isBroadcastRecipient);
}

export async function resolveAudienceOnServer(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  audience: AudienceConfig
): Promise<Contact[]> {
  return loadAudience<Contact>(supabase, accountId, audience, '*', (rows) =>
    upsertCsvContactsOnServer(supabase, accountId, userId, rows)
  );
}

export async function countAudienceOnServer(
  supabase: SupabaseClient,
  accountId: string,
  audience: AudienceConfig,
  { optedInOnly = false }: { optedInOnly?: boolean } = {}
): Promise<number> {
  const contacts = await loadAudience<AudienceCandidate>(
    supabase,
    accountId,
    audience,
    AUDIENCE_COLUMNS,
    async (rows) => {
      const { matched, missing } = await matchCsvContacts<AudienceCandidate>(
        supabase,
        accountId,
        rows,
        AUDIENCE_COLUMNS
      );
      return [
        ...matched,
        ...missing.map((row) => ({ id: '', phone: row.phone })),
      ];
    }
  );
  return (optedInOnly ? onlyOptedIn(contacts) : contacts).length;
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
