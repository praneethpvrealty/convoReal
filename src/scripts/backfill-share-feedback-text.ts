/**
 * Backfill `messages.content_text` for property share feedback templates that
 * were stored without their rendered body, and the conversation previews that
 * still read `[template:property_share_feedback]`.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-share-feedback-text.ts
 *   npx tsx src/scripts/backfill-share-feedback-text.ts --account-id=<uuid> --apply
 *
 * Defaults:
 *   --batch-size=200
 *   --dry-run (default)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import {
  buildShareFeedbackParams,
  renderShareFeedbackBody,
  SHARE_FEEDBACK_TEMPLATE_NAME,
} from '@/lib/whatsapp/share-feedback-template';

interface FeedbackMessageRow {
  id: string;
  account_id: string;
  conversation_id: string;
  conversations: { contact_id: string | null } | null;
}

interface ConversationRow {
  id: string;
  account_id: string;
  contact_id: string | null;
}

const PREVIEW_PLACEHOLDER = `[template:${SHARE_FEEDBACK_TEMPLATE_NAME}]`;

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
const contactNames = new Map<string, string | null>();
const templateLanguages = new Map<string, string | null>();

async function contactName(
  account: string,
  contactId: string | null
): Promise<string | null> {
  if (!contactId) return null;
  if (contactNames.has(contactId)) return contactNames.get(contactId) ?? null;
  const { data, error } = await supabase
    .from('contacts')
    .select('name')
    .eq('id', contactId)
    .eq('account_id', account)
    .maybeSingle();
  if (error)
    throw new Error(`Failed to load contact ${contactId}: ${error.message}`);
  const name = (data?.name as string | null | undefined) ?? null;
  contactNames.set(contactId, name);
  return name;
}

async function templateLanguage(account: string): Promise<string | null> {
  if (templateLanguages.has(account))
    return templateLanguages.get(account) ?? null;
  const { data, error } = await supabase
    .from('message_templates')
    .select('language')
    .eq('account_id', account)
    .eq('name', SHARE_FEEDBACK_TEMPLATE_NAME)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(`Failed to load template for ${account}: ${error.message}`);
  const language = (data?.language as string | null | undefined) ?? null;
  templateLanguages.set(account, language);
  return language;
}

async function renderFor(
  account: string,
  contactId: string | null
): Promise<string> {
  const params = buildShareFeedbackParams(
    await contactName(account, contactId)
  );
  return renderShareFeedbackBody(params, await templateLanguage(account));
}

async function fetchMessagePage(
  afterId: string | null
): Promise<FeedbackMessageRow[]> {
  let query = supabase
    .from('messages')
    .select('id, account_id, conversation_id, conversations!inner(contact_id)')
    .eq('template_name', SHARE_FEEDBACK_TEMPLATE_NAME)
    .eq('content_type', 'template')
    .is('content_text', null)
    .order('id', { ascending: true })
    .limit(batchSize);
  if (accountId) query = query.eq('account_id', accountId);
  if (afterId) query = query.gt('id', afterId);
  const { data, error } = await query;
  if (error)
    throw new Error(`Failed to load feedback messages: ${error.message}`);
  return (data ?? []) as unknown as FeedbackMessageRow[];
}

async function backfillMessages() {
  let afterId: string | null = null;
  let scanned = 0;
  let updated = 0;
  let failed = 0;

  while (true) {
    const rows = await fetchMessagePage(afterId);
    if (rows.length === 0) break;
    afterId = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned++;
      const text = await renderFor(
        row.account_id,
        row.conversations?.contact_id ?? null
      );
      if (dryRun) {
        console.log(`  [dry-run] ${row.id}: ${JSON.stringify(text)}`);
        continue;
      }
      const { error } = await supabase
        .from('messages')
        .update({ content_text: text })
        .eq('id', row.id)
        .eq('account_id', row.account_id)
        .is('content_text', null);
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

  return { scanned, updated, failed };
}

async function backfillPreviews() {
  let query = supabase
    .from('conversations')
    .select('id, account_id, contact_id')
    .eq('last_message_text', PREVIEW_PLACEHOLDER);
  if (accountId) query = query.eq('account_id', accountId);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load conversations: ${error.message}`);

  let updated = 0;
  let failed = 0;
  for (const conversation of (data ?? []) as ConversationRow[]) {
    const text = await renderFor(
      conversation.account_id,
      conversation.contact_id
    );
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
      .eq('last_message_text', PREVIEW_PLACEHOLDER);
    if (updateError) {
      failed++;
      console.error(
        `  failed to update preview ${conversation.id}: ${updateError.message}`
      );
    } else {
      updated++;
    }
  }

  return { scanned: data?.length ?? 0, updated, failed };
}

async function main() {
  console.log(
    `Backfilling ${SHARE_FEEDBACK_TEMPLATE_NAME} text${accountId ? ` for ${accountId}` : ''}${dryRun ? ' (dry run)' : ''}`
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
