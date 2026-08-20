/**
 * Edits an account's already-approved `location_reveal` template on
 * Meta so its body carries the property's specs and address ({{3}} and
 * {{4}}) alongside the name and title it always had.
 *
 * The reveal message gained those facts on the free-form path first;
 * the template path is what reaches a seeker whose 24-hour window has
 * closed, which is most of them. `buildLocationRevealParams` already
 * produces four params, and the sender slices them to whatever the
 * stored body declares — so this edit is what makes the extra two
 * start flowing, and nothing breaks while it has not run.
 *
 * Usage:
 *   npx tsx src/scripts/edit-location-reveal-template.ts --dry-run
 *   npx tsx src/scripts/edit-location-reveal-template.ts
 *   npx tsx src/scripts/edit-location-reveal-template.ts --account=<uuid>
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * ENCRYPTION_KEY. The button URL is taken from the live row rather than
 * rebuilt, so an account whose reveal link points at its own showcase
 * domain keeps it.
 *
 * Category is NOT sent as a change: the payload's category is the one
 * the row already holds. Meta fixes a category at first review and
 * rejects the whole edit — content included — if one arrives that
 * differs (AGENTS.md §2.7).
 *
 * Idempotent: a row whose body already declares {{4}} is skipped.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import {
  buildLocationRevealTemplatePayload,
  LOCATION_REVEAL_TEMPLATE_NAME,
} from '@/lib/whatsapp/location-reveal-template';
import { validateTemplatePayload } from '@/lib/whatsapp/template-validators';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { editMessageTemplate } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { languageForMetaCode, DEFAULT_LANGUAGE } from '@/lib/languages';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');
const accountArg = process.argv.find((a) => a.startsWith('--account='));
const onlyAccountId = accountArg ? accountArg.split('=')[1] : null;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE environment variables.');
  process.exit(1);
}
if (!process.env.ENCRYPTION_KEY && !dryRun) {
  console.error('Missing ENCRYPTION_KEY — needed to decrypt the access token.');
  process.exit(1);
}

async function main() {
  const db = createClient(supabaseUrl!, serviceRoleKey!);

  let query = db
    .from('message_templates')
    .select(
      'id, account_id, language, status, category, meta_template_id, body_text, buttons'
    )
    .eq('name', LOCATION_REVEAL_TEMPLATE_NAME);
  if (onlyAccountId) query = query.eq('account_id', onlyAccountId);

  const { data: rows, error } = await query;
  if (error) throw error;
  if (!rows?.length) {
    console.log('No location_reveal templates found.');
    return;
  }

  for (const row of rows) {
    const label = `${row.account_id} (${row.language})`;
    if (row.status !== 'APPROVED') {
      console.log(`SKIP ${label}: status is ${row.status}, not APPROVED.`);
      continue;
    }
    if (!row.meta_template_id) {
      console.log(`SKIP ${label}: no meta_template_id.`);
      continue;
    }
    if ((row.body_text || '').includes('{{4}}')) {
      console.log(`SKIP ${label}: body already carries {{4}}.`);
      continue;
    }

    const language = languageForMetaCode(row.language) ?? DEFAULT_LANGUAGE;
    const payload = buildLocationRevealTemplatePayload(
      'https://www.convoreal.com',
      language
    );
    // The live button is authoritative — it may point at the account's
    // own showcase domain, which rebuilding from a fixed origin would
    // silently overwrite.
    const liveButtons = row.buttons as typeof payload.buttons | null;
    if (liveButtons?.length) payload.buttons = liveButtons;
    // Never a category CHANGE: assert the one the row already holds.
    payload.category = row.category as typeof payload.category;

    validateTemplatePayload(payload);
    const metaPayload = buildMetaTemplatePayload(payload);

    console.log(`\n=== ${label} — meta ${row.meta_template_id} ===`);
    console.log(`category: ${metaPayload.category}`);
    console.log(JSON.stringify(metaPayload.components, null, 2));

    if (dryRun) {
      console.log('DRY RUN — not sent.');
      continue;
    }

    const { data: config } = await db
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', row.account_id)
      .single();
    if (!config?.access_token) {
      console.error(`FAIL ${label}: WhatsApp not configured.`);
      continue;
    }

    try {
      await editMessageTemplate({
        metaTemplateId: row.meta_template_id,
        accessToken: decrypt(config.access_token),
        components: metaPayload.components,
        category: metaPayload.category,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Meta edit failed.';
      console.error(`FAIL ${label}: ${message}`);
      await db
        .from('message_templates')
        .update({
          submission_error: message,
          last_submitted_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      continue;
    }

    // Meta accepted the edit — it re-reviews, so the row goes PENDING
    // until the template webhook or "Sync from Meta" lands the verdict.
    const { error: updErr } = await db
      .from('message_templates')
      .update({
        body_text: payload.body_text,
        sample_values: payload.sample_values ?? null,
        status: 'PENDING',
        submission_error: null,
        rejection_reason: null,
        last_submitted_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (updErr) {
      console.error(
        `WARN ${label}: Meta edited but the row did not update: ${updErr.message}`
      );
      continue;
    }
    console.log(`OK ${label}: edit accepted, row is PENDING re-review.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
