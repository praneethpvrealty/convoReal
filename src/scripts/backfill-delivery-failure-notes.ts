/**
 * Move legacy "❌ Delivery Failed:" notes out of `messages.content_text` into
 * `error_code` / `error_info` / `retry_after`, restoring the composed body,
 * and strip the note from conversation previews.
 *
 * A message whose stored text was only the note is left with no body; run
 * `backfill-share-feedback-text.ts` afterwards to rebuild feedback templates.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-delivery-failure-notes.ts
 *   npx tsx src/scripts/backfill-delivery-failure-notes.ts --account-id=<uuid> --apply
 *
 * Defaults:
 *   --batch-size=200
 *   --dry-run (default)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import {
  DELIVERY_FAILURE_MARKER,
  isMarketingBlockCode,
  laterSuppression,
  legacyDeliveryFailureSplit,
  stripDeliveryFailure,
} from '@/lib/whatsapp/delivery-failure';

interface MessageRow {
  id: string;
  account_id: string;
  conversation_id: string;
  status: string | null;
  content_text: string | null;
  error_code: number | null;
  error_info: string | null;
  retry_after: string | null;
  created_at: string;
  conversations: {
    contact_id: string | null;
    last_customer_message_at: string | null;
  } | null;
}

interface ConversationRow {
  id: string;
  account_id: string;
  last_message_text: string | null;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const accountId = parseArg('account-id');
const rawBatchSize = parseArg('batch-size');
const batchSize = rawBatchSize ? Number.parseInt(rawBatchSize, 10) : 200;
const dryRun = !process.argv.includes('--apply');

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE environment variables.');
  process.exit(1);
}

if (!Number.isFinite(batchSize) || batchSize <= 0) {
  console.error('--batch-size must be a positive number.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const markerPattern = `%${DELIVERY_FAILURE_MARKER}%`;

async function fetchMessagePage(afterId: string | null): Promise<MessageRow[]> {
  let query = supabase
    .from('messages')
    .select(
      'id, account_id, conversation_id, status, content_text, error_code, error_info, retry_after, created_at, conversations!inner(contact_id, last_customer_message_at)'
    )
    .like('content_text', markerPattern)
    .order('id', { ascending: true })
    .limit(batchSize);
  if (accountId) query = query.eq('account_id', accountId);
  if (afterId) query = query.gt('id', afterId);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load messages: ${error.message}`);
  return (data ?? []) as unknown as MessageRow[];
}

async function extendContactSuppression(
  row: MessageRow,
  code: number,
  until: string
): Promise<boolean> {
  const contactId = row.conversations?.contact_id;
  if (!contactId) return false;
  const repliedAt = row.conversations?.last_customer_message_at;
  if (repliedAt && new Date(repliedAt) > new Date(row.created_at)) return false;
  const { data: contact, error } = await supabase
    .from('contacts')
    .select(
      'whatsapp_marketing_suppressed_until, whatsapp_marketing_suppression_code'
    )
    .eq('id', contactId)
    .eq('account_id', row.account_id)
    .maybeSingle();
  if (error)
    throw new Error(`Failed to load contact ${contactId}: ${error.message}`);
  const standing = contact?.whatsapp_marketing_suppressed_until as
    string | null | undefined;
  const later = laterSuppression(standing, until);
  if (later === standing) return false;
  if (dryRun) {
    console.log(
      `  [dry-run] pause contact ${contactId} until ${later} (${code})`
    );
    return true;
  }
  const { error: updateError } = await supabase
    .from('contacts')
    .update({
      whatsapp_marketing_suppressed_until: later,
      whatsapp_marketing_suppression_code: code,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)
    .eq('account_id', row.account_id);
  if (updateError)
    throw new Error(
      `Failed to pause contact ${contactId}: ${updateError.message}`
    );
  return true;
}

async function backfillMessages() {
  let afterId: string | null = null;
  let scanned = 0;
  let updated = 0;
  let emptied = 0;
  let paused = 0;
  let failed = 0;

  while (true) {
    const rows = await fetchMessagePage(afterId);
    if (rows.length === 0) break;
    afterId = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned++;
      const split = legacyDeliveryFailureSplit(
        row.content_text,
        new Date(row.created_at)
      );
      if (!split) continue;
      const update: Record<string, unknown> = {
        content_text: split.content_text,
      };
      if (row.status === 'failed') {
        update.error_code = row.error_code ?? split.error_code;
        update.error_info = row.error_info ?? split.error_info;
        update.retry_after = row.retry_after ?? split.retry_after;
      }
      if (!split.content_text) emptied++;
      if (
        row.status === 'failed' &&
        isMarketingBlockCode(split.error_code) &&
        split.retry_after &&
        new Date(split.retry_after) > new Date() &&
        (await extendContactSuppression(
          row,
          split.error_code as number,
          split.retry_after
        ))
      ) {
        paused++;
      }
      if (dryRun) {
        console.log(
          `  [dry-run] ${row.id}: ${JSON.stringify(update).slice(0, 200)}`
        );
        continue;
      }
      const { error } = await supabase
        .from('messages')
        .update(update)
        .eq('id', row.id)
        .eq('account_id', row.account_id)
        .eq('content_text', row.content_text);
      if (error) {
        failed++;
        console.error(`  failed to update message ${row.id}: ${error.message}`);
      } else {
        updated++;
      }
    }
    console.log(
      `Messages: scanned ${scanned}, updated ${updated}, failed ${failed}`
    );
  }

  return { scanned, updated, emptied, paused, failed };
}

async function previewFallback(
  conversation: ConversationRow
): Promise<string | null> {
  const { data, error } = await supabase
    .from('messages')
    .select('content_text, template_name')
    .eq('conversation_id', conversation.id)
    .eq('account_id', conversation.account_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(
      `Failed to load latest message for ${conversation.id}: ${error.message}`
    );
  const text = stripDeliveryFailure(data?.content_text as string | null);
  if (text) return text;
  return data?.template_name ? `[template:${data.template_name}]` : null;
}

async function fetchPreviewPage(
  afterId: string | null
): Promise<ConversationRow[]> {
  let query = supabase
    .from('conversations')
    .select('id, account_id, last_message_text')
    .like('last_message_text', markerPattern)
    .order('id', { ascending: true })
    .limit(batchSize);
  if (accountId) query = query.eq('account_id', accountId);
  if (afterId) query = query.gt('id', afterId);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load conversations: ${error.message}`);
  return (data ?? []) as ConversationRow[];
}

async function backfillPreviews() {
  let afterId: string | null = null;
  let scanned = 0;
  let updated = 0;
  let failed = 0;

  while (true) {
    const rows = await fetchPreviewPage(afterId);
    if (rows.length === 0) break;
    afterId = rows[rows.length - 1].id;

    for (const conversation of rows) {
      scanned++;
      const text =
        stripDeliveryFailure(conversation.last_message_text) ||
        (await previewFallback(conversation));
      if (dryRun) {
        console.log(
          `  [dry-run] preview ${conversation.id}: ${JSON.stringify(text)}`
        );
        continue;
      }
      const { error: updateError } = await supabase
        .from('conversations')
        .update({ last_message_text: text })
        .eq('id', conversation.id)
        .eq('account_id', conversation.account_id)
        .eq('last_message_text', conversation.last_message_text);
      if (updateError) {
        failed++;
        console.error(
          `  failed to update preview ${conversation.id}: ${updateError.message}`
        );
      } else {
        updated++;
      }
    }
  }

  return { scanned, updated, failed };
}

async function main() {
  console.log(
    `Moving delivery failure notes${accountId ? ` for ${accountId}` : ''}${dryRun ? ' (dry run)' : ''}`
  );
  const messages = await backfillMessages();
  const previews = await backfillPreviews();
  console.log('Done.', { messages, previews });
  if (messages.failed || previews.failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
