/**
 * Backfill `outbound_whatsapp` journey events for historical personal WhatsApp
 * messages that were sent through the engine before capture was wired.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-personal-whatsapp-journey-events.ts --account-id=<uuid> --source=web
 *   npx tsx src/scripts/backfill-personal-whatsapp-journey-events.ts --account-id=<uuid> --source=mobile --apply
 *
 * Defaults:
 *   --source=web
 *   --batch-size=400
 *   --dry-run (default)
 *
 * Notes:
 *   - One message can map to multiple journey items (multiple properties per
 *     contact). All rows receive the same metadata except for their item_id.
 *   - `outbound_whatsapp` writes are idempotent thanks to the dedupe index.
 *   - Duplicate rows are counted but do not fail the run.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { writeJourneyEvent } from '@/lib/journey/events';
import {
  buildPersonalWhatsAppJourneyMetadata,
  cleanJourneyMessage,
  inferPersonalWhatsAppJourneyMessage,
  personalJourneyDedupeKey,
} from '@/lib/journey/personal-whatsapp-events';

type JourneyEventSource = 'web' | 'mobile';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface JourneyItemRow {
  id: string;
  property_id: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content_type: string;
  content_text: string | null;
  template_name: string | null;
  created_at: string;
  conversations: Array<{
    account_id: string;
    contact_id: string;
  }> | null;
}

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const accountIdArg = parseArg('account-id');
const conversationId = parseArg('conversation-id');
const sourceArg = parseArg('source');
const source: JourneyEventSource = sourceArg === 'mobile' ? 'mobile' : 'web';
const since = parseArg('since');
const until = parseArg('until');
const rawBatchSize = parseArg('batch-size');
const dryRun = !process.argv.includes('--apply');
const batchSize = rawBatchSize ? Number.parseInt(rawBatchSize, 10) : 400;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE environment variables.');
  process.exit(1);
}

if (!accountIdArg) {
  console.error('Missing --account-id.');
  process.exit(1);
}

const accountId = accountIdArg;

if (!Number.isFinite(batchSize) || batchSize <= 0) {
  console.error('--batch-size must be a positive number.');
  process.exit(1);
}

if (sourceArg && sourceArg !== 'web' && sourceArg !== 'mobile') {
  console.error('--source must be "web" or "mobile".');
  process.exit(1);
}

if (since && Number.isNaN(Date.parse(since))) {
  console.error('--since must be a valid ISO date or RFC-3339 datetime.');
  process.exit(1);
}

if (until && Number.isNaN(Date.parse(until))) {
  console.error('--until must be a valid ISO date or RFC-3339 datetime.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const journeyItemsCache = new Map<string, JourneyItemRow[]>();

function cacheKey(contactId: string): string {
  return `${accountId}::${contactId}`;
}

async function fetchJourneyItems(contactId: string): Promise<JourneyItemRow[]> {
  const key = cacheKey(contactId);
  if (journeyItemsCache.has(key)) return journeyItemsCache.get(key) ?? [];

  const { data, error } = await supabase
    .from('journey_items')
    .select('id, property_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId);

  if (error) {
    console.error(`  failed to load journey items for contact ${contactId}:`, error.message);
    journeyItemsCache.set(key, []);
    return [];
  }

  const items = (data ?? []) as JourneyItemRow[];
  journeyItemsCache.set(key, items);
  return items;
}

async function fetchMessagePage(offset: number): Promise<MessageRow[]> {
  let query = supabase
    .from('messages')
    .select(
      'id, conversation_id, sender_id, sender_type, content_type, content_text, template_name, created_at, conversations!inner(account_id, contact_id)',
    )
    .eq('sender_type', 'agent')
    .eq('conversations.account_id', accountId)
    .neq('status', 'failed')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + batchSize - 1);

  if (conversationId) query = query.eq('conversation_id', conversationId);
  if (since) query = query.gte('created_at', since);
  if (until) query = query.lte('created_at', until);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load personal WhatsApp messages: ${error.message}`);
  }

  return (data as MessageRow[]) ?? [];
}

async function backfillPersonalWhatsAppJourneyEvents() {
  let offset = 0;
  let processed = 0;
  let matchedItems = 0;
  let skippedNoMessage = 0;
  let skippedNoJourneyItem = 0;
  let created = 0;
  let duplicates = 0;
  let failed = 0;

  while (true) {
    const messages = await fetchMessagePage(offset);
    if (messages.length === 0) break;

    for (const message of messages) {
      processed++;
      const conversation = message.conversations?.[0];
      if (!conversation?.contact_id) {
        skippedNoMessage++;
        continue;
      }

      const rawMessage = inferPersonalWhatsAppJourneyMessage({
        contentType: message.content_type,
        contentText: message.content_text,
        templateName: message.template_name,
      });
      const messageText = rawMessage ? cleanJourneyMessage(rawMessage) : '';
      if (!messageText) {
        skippedNoMessage++;
        continue;
      }

      const items = await fetchJourneyItems(conversation.contact_id);
      if (!items.length) {
        skippedNoJourneyItem++;
        continue;
      }

      for (const item of items) {
        matchedItems++;
        if (dryRun) continue;

        const outcome = await writeJourneyEvent({
          db: supabase,
          accountId,
          itemId: item.id,
          eventType: 'outbound_whatsapp',
          createdBy: message.sender_id,
          dedupeKey: personalJourneyDedupeKey({
            itemId: item.id,
            message: messageText,
            source,
            senderId: message.sender_id,
          }),
          metadata: buildPersonalWhatsAppJourneyMetadata({
            source,
            senderType: 'agent',
            senderId: message.sender_id,
            itemId: item.id,
            contactId: conversation.contact_id,
            propertyId: item.property_id,
            conversationId: message.conversation_id,
            message: messageText,
          }),
        });

        if (outcome.ok) {
          if (outcome.duplicate) duplicates++;
          else created++;
        } else {
          failed++;
          console.error(
            `  failed to persist event for message ${message.id}, item ${item.id}:`,
            outcome.error,
          );
        }
      }
    }

    if (messages.length < batchSize) break;
    offset += batchSize;
    await sleep(250);
  }

  console.log(
    [
      `Backfill complete${dryRun ? ' (dry run)' : ''}.`,
      `Processed ${processed} messages.`,
      `${matchedItems} item mappings considered.`,
      `${dryRun ? 'Would create' : 'Created'} ${created} new journey events.`,
      `${dryRun ? 'Would skip' : 'Skipped'} ${duplicates} duplicate events.`,
      `${dryRun ? 'Would skip' : 'Failed to write'} ${failed} events.`,
      `${skippedNoMessage} messages had no usable message text.`,
      `${skippedNoJourneyItem} messages had no journey items.`,
    ].join(' '),
  );

  if (!dryRun) {
    console.log(
      'Run this script again with --dry-run to review a future window without writing.',
    );
  }
}

void backfillPersonalWhatsAppJourneyEvents().catch((error) => {
  console.error(error);
  process.exit(1);
});
