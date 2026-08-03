/**
 * Submits the built-in `location_reveal` Utility template to Meta for
 * existing accounts. New accounts get it through the onboarding
 * wizard's starter templates; accounts that onboarded earlier never
 * had it submitted, so the reveal fallback for approved location
 * requests outside the 24-hour window has no approved template to use.
 *
 * Usage:
 *   npx tsx src/scripts/submit-location-reveal-template.ts               # all connected accounts
 *   npx tsx src/scripts/submit-location-reveal-template.ts --dry-run    # preview
 *   npx tsx src/scripts/submit-location-reveal-template.ts --account=<uuid>
 *   npx tsx src/scripts/submit-location-reveal-template.ts --origin=https://www.convoreal.com
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   ENCRYPTION_KEY, NEXT_PUBLIC_SITE_URL (or --origin)
 *
 * The origin must be https and must be the public domain that serves
 * /reveal/[token] — it is baked into the template's URL button on
 * Meta's side, so a localhost origin would ship a broken button.
 * --origin overrides NEXT_PUBLIC_SITE_URL for dev machines whose env
 * points at localhost.
 *
 * Idempotent — an account whose latest location_reveal row is already
 * APPROVED or PENDING is left alone; DRAFT/REJECTED rows are
 * re-submitted. Meta approval lands later via the template webhook or
 * "Sync from Meta".
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');
const accountArg = process.argv.find((a) => a.startsWith('--account='));
const onlyAccountId = accountArg ? accountArg.split('=')[1] : null;
const originArg = process.argv.find((a) => a.startsWith('--origin='));
const origin = originArg
  ? originArg.split('=')[1]
  : process.env.NEXT_PUBLIC_SITE_URL;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE environment variables.');
  process.exit(1);
}
if (!origin) {
  console.error(
    'Missing origin — set NEXT_PUBLIC_SITE_URL or pass --origin=https://...'
  );
  process.exit(1);
}
if (!origin.startsWith('https://')) {
  console.error(
    `Origin ${origin} is not https. The template's URL button is created on Meta's side and must point at the public /reveal domain — pass --origin=https://<your-production-domain>.`
  );
  process.exit(1);
}
if (!process.env.ENCRYPTION_KEY && !dryRun) {
  console.error(
    'Missing ENCRYPTION_KEY — cannot decrypt WhatsApp access tokens.'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Dynamic imports, after dotenv: static imports are hoisted above
  // dotenv.config(), and encryption.ts captures ENCRYPTION_KEY into a
  // module-level const at evaluation time — importing it statically
  // bakes in undefined and decrypt() throws on Buffer.from(undefined).
  const { decrypt } = await import('../lib/whatsapp/encryption');
  const { submitMessageTemplate } = await import('../lib/whatsapp/meta-api');
  const { validateTemplatePayload } =
    await import('../lib/whatsapp/template-validators');
  const { buildMetaTemplatePayload } =
    await import('../lib/whatsapp/template-components');
  const { normalizeStatus } =
    await import('../lib/whatsapp/template-status-normalize');
  const { LOCATION_REVEAL_TEMPLATE_NAME, buildLocationRevealTemplatePayload } =
    await import('../lib/whatsapp/location-reveal-template');

  const payload = buildLocationRevealTemplatePayload(origin!);
  validateTemplatePayload(payload);
  const metaPayload = buildMetaTemplatePayload(payload);

  let configQuery = supabase
    .from('whatsapp_config')
    .select('account_id, waba_id, access_token')
    .not('waba_id', 'is', null);
  if (onlyAccountId) configQuery = configQuery.eq('account_id', onlyAccountId);
  const { data: configs, error: configErr } = await configQuery;
  if (configErr) {
    console.error('Failed to fetch whatsapp_config rows:', configErr.message);
    process.exit(1);
  }
  if (!configs?.length) {
    console.log('No connected WhatsApp accounts found.');
    return;
  }
  console.log(
    `${configs.length} connected account(s); template button base ${origin}${dryRun ? ' (dry run)' : ''}.`
  );

  let submitted = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, config] of configs.entries()) {
    const label = config.account_id as string;

    const { data: existing } = await supabase
      .from('message_templates')
      .select('id, status')
      .eq('account_id', config.account_id)
      .eq('name', LOCATION_REVEAL_TEMPLATE_NAME)
      .order('last_submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing && ['APPROVED', 'PENDING'].includes(existing.status)) {
      console.log(`  – ${label}: already ${existing.status}, skipping`);
      skipped++;
      continue;
    }

    const { data: account } = await supabase
      .from('accounts')
      .select('owner_user_id')
      .eq('id', config.account_id)
      .maybeSingle();
    if (!account?.owner_user_id) {
      console.error(`  ✗ ${label}: no owner_user_id, skipping`);
      failed++;
      continue;
    }

    if (dryRun) {
      console.log(
        `[dry] ${label}: would submit ${LOCATION_REVEAL_TEMPLATE_NAME} to WABA ${config.waba_id}`
      );
      submitted++;
      continue;
    }

    let metaTemplateId: string;
    let metaStatus: string;
    try {
      const meta = await submitMessageTemplate({
        wabaId: config.waba_id,
        accessToken: decrypt(config.access_token),
        payload: metaPayload,
      });
      metaTemplateId = meta.id;
      metaStatus = meta.status;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Meta submit failed';
      // "already exists" means the template lives on the WABA but not in
      // our table — recoverable via "Sync from Meta" in Settings.
      console.error(`  ✗ ${label}: ${message}`);
      failed++;
      continue;
    }

    const row = {
      account_id: config.account_id,
      user_id: account.owner_user_id,
      name: payload.name,
      category: payload.category,
      language: payload.language,
      header_type: null,
      header_content: null,
      header_media_url: null,
      header_handle: null,
      body_text: payload.body_text,
      footer_text: payload.footer_text ?? null,
      buttons: payload.buttons ?? null,
      sample_values: payload.sample_values ?? null,
      status: normalizeStatus(metaStatus),
      meta_template_id: metaTemplateId,
      submission_error: null,
      rejection_reason: null,
      last_submitted_at: new Date().toISOString(),
    };
    const { error: upsertErr } = existing?.id
      ? await supabase
          .from('message_templates')
          .update(row)
          .eq('id', existing.id)
      : await supabase.from('message_templates').insert(row);
    if (upsertErr) {
      console.error(
        `  ✗ ${label}: submitted to Meta (${metaTemplateId}) but failed to save locally: ${upsertErr.message}. Run "Sync from Meta" to recover.`
      );
      failed++;
      continue;
    }

    console.log(
      `  ✓ ${label}: submitted, status ${normalizeStatus(metaStatus)}`
    );
    submitted++;

    // Meta caps template creates at 100/hour per WABA; pace the run.
    if ((i + 1) % 5 === 0) await sleep(1000);
  }

  console.log(
    `Done. ${submitted} submitted, ${skipped} skipped, ${failed} failed.`
  );
}

main();
