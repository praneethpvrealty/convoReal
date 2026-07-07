import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';

export interface CustomFieldFilter {
  fieldId: string;
  operator: 'is' | 'is_not' | 'contains';
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
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
  customValues?: Map<string, string>,
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
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    // custom_field
    return customValues?.get(v.value) ?? '';
  });
}

async function upsertCsvContactsOnServer(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  csvRows: { phone: string; name?: string }[],
): Promise<Contact[]> {
  if (csvRows.length === 0) return [];

  // De-duplicate by phone within the CSV
  const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
  for (const row of csvRows) {
    if (row.phone) uniqueByPhone.set(row.phone, row);
  }
  const phones = [...uniqueByPhone.keys()];

  // Single round-trip lookup of existing contacts by phone
  const { data: existing, error: lookupErr } = await supabase
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .in('phone', phones);

  if (lookupErr) {
    throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
  }

  const byPhone = new Map<string, Contact>();
  for (const c of (existing ?? []) as Contact[]) {
    if (c.phone) byPhone.set(c.phone, c);
  }

  // Insert missing contacts
  const missing = phones
    .filter((p) => !byPhone.has(p))
    .map((phone) => ({
      user_id: userId,
      account_id: accountId,
      phone,
      name: uniqueByPhone.get(phone)?.name ?? null,
    }));

  const INSERT_CHUNK = 200;
  for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
    const chunk = missing.slice(i, i + INSERT_CHUNK);
    const { data: inserted, error: insertErr } = await supabase
      .from('contacts')
      .insert(chunk)
      .select();
    if (insertErr) {
      throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
    }
    for (const c of (inserted ?? []) as Contact[]) {
      if (c.phone) byPhone.set(c.phone, c);
    }
  }

  return phones
    .map((p) => byPhone.get(p))
    .filter((c): c is Contact => Boolean(c));
}

export async function resolveAudienceOnServer(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  audience: AudienceConfig,
): Promise<Contact[]> {
  let contacts: Contact[] = [];

  if (audience.type === 'all') {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('account_id', accountId);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    contacts = data ?? [];
  } else if (
    audience.type === 'tags' &&
    audience.tagIds &&
    audience.tagIds.length > 0
  ) {
    const { data: contactTags, error: tagError } = await supabase
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', audience.tagIds);

    if (tagError) {
      throw new Error(`Failed to fetch contact tags: ${tagError.message}`);
    }

    if (contactTags && contactTags.length > 0) {
      const uniqueContactIds = [
        ...new Set(contactTags.map((ct) => ct.contact_id)),
      ];
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .in('id', uniqueContactIds);
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = data ?? [];
    }
  } else if (audience.type === 'custom_field' && audience.customField) {
    const { fieldId, operator, value } = audience.customField;

    let query = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);

    if (operator === 'is') query = query.eq('value', value);
    else if (operator === 'is_not') query = query.neq('value', value);
    else if (operator === 'contains') query = query.ilike('value', `%${value}%`);

    const { data: matches, error: matchErr } = await query;
    if (matchErr) throw new Error(`Custom-field filter failed: ${matchErr.message}`);

    const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
    if (contactIds.length > 0) {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .in('id', contactIds);
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = data ?? [];
    }
  } else if (audience.type === 'csv' && audience.csvContacts) {
    contacts = await upsertCsvContactsOnServer(supabase, accountId, userId, audience.csvContacts);
  }

  // Exclude tags
  if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
    const { data: excludeRows } = await supabase
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', audience.excludeTagIds);
    const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
    contacts = contacts.filter((c) => !excludedIds.has(c.id));
  }

  return contacts;
}

export async function sendBroadcastRecipients(
  broadcastId: string,
  accountId: string,
  userId: string,
  limit: number = 200,
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

  // Find recipients with status 'pending' or 'rate_limited' (and retry_after <= now)
  const nowStr = new Date().toISOString();
  const { data: recipients, error: rFetchErr } = await supabase
    .from('broadcast_recipients')
    .select('*, contact:contacts(*)')
    .eq('broadcast_id', broadcastId)
    .in('status', ['pending', 'rate_limited'])
    .or(`retry_after.is.null,retry_after.lte.${nowStr}`)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (rFetchErr) {
    console.error(`[Broadcast Sender] Error fetching recipients for ${broadcastId}:`, rFetchErr.message);
    return;
  }

  if (!recipients || recipients.length === 0) {
    // Check if there are any remaining non-terminal recipients left for this broadcast
    const { count, error: countErr } = await supabase
      .from('broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', broadcastId)
      .in('status', ['pending', 'rate_limited']);

    if (!countErr && (count ?? 0) === 0) {
      const { data: summary } = await supabase
        .from('broadcast_recipients')
        .select('status')
        .eq('broadcast_id', broadcastId);

      const allFailed = summary && summary.length > 0 && summary.every((r) => r.status === 'failed');
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

  // Pre-load custom contact values for the batch
  const contactIds = recipients.map((r) => r.contact_id).filter((id): id is string => Boolean(id));
  const customValueIndex = new Map<string, Map<string, string>>();
  if (contactIds.length > 0) {
    const { data: cvRows } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', contactIds);

    for (const row of cvRows ?? []) {
      const bucket = customValueIndex.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      customValueIndex.set(row.contact_id, bucket);
    }
  }

  const BATCH_SIZE = 10;
  const DELAY_MS = 1000;
  const MAX_RETRIES = 5;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
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

      const bodyParams = resolveVariables(
        broadcast.template_variables || {},
        recipient.contact,
        customValueIndex.get(recipient.contact.id),
      );

      let truncatedParams = bodyParams;
      if (templateRow?.body_text) {
        truncatedParams = truncateParametersToBudget(templateRow.body_text, bodyParams);
      }

      const resolvedText = templateRow?.body_text
        ? resolveTemplateBodyText(templateRow.body_text, truncatedParams)
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
          templateLanguage: templateRow?.language || broadcast.template_language || 'en_US',
          templateParams: truncatedParams,
          templateRow: templateRow ?? undefined,
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
          const retryAfter = rateLimited && newCount < MAX_RETRIES
            ? new Date(Date.now() + backoffMs).toISOString()
            : null;

          await supabase
            .from('broadcast_recipients')
            .update({
              status: rateLimited && newCount < MAX_RETRIES ? 'rate_limited' : 'failed',
              retry_count: newCount,
              retry_after: retryAfter,
              error_message: errMsg,
            })
            .eq('id', recipient.id);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Internal Send Error';
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
