/**
 * One-time backfill: recover the portal ad each existing lead came in on.
 *
 * contacts.lead_portal / lead_portal_listing_id (migration 264) are set
 * by the lead webhook, so they exist only for leads that arrived after
 * it shipped. Every earlier portal lead is invisible to the unmapped-ads
 * queue and to the one-tap assertion — including the ones sitting in
 * Needs Review against a listing the scorer merely guessed. The raw mail
 * is still in email_sync_logs, so the id is recoverable.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-lead-portal-refs.ts            # preview
 *   npx tsx src/scripts/backfill-lead-portal-refs.ts --apply    # write
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Preview by default — the opposite of the other scripts here, because
 * this one writes to contacts rather than to a derived column, and the
 * recovery rate depends entirely on how much of each mail was kept.
 *
 * Idempotent, and conservative on two counts. It only fills contacts
 * whose lead_portal_listing_id IS NULL, so a reference the webhook or an
 * agent already established is never overwritten. And it never tags a
 * property: it records which ad the lead quoted and stops there, leaving
 * the mapping itself to the agent's assertion, which is the one step
 * that must stay a human decision.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { normalizePhoneWithCountryCode } from '../lib/whatsapp/phone-utils';
import {
  latestRefsByPhone,
  type SyncLogRow,
} from '../lib/portals/lead-portal-backfill';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apply = process.argv.includes('--apply');

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  // Newest first: latestRefsByPhone takes the first hit per phone, so a
  // buyer who enquired twice keeps the ad they enquired about last.
  const { data: logs, error } = await supabase
    .from('email_sync_logs')
    .select(
      'account_id, sender, subject, body_preview, extracted_phone, created_at'
    )
    .not('extracted_phone', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to read email_sync_logs:', error.message);
    process.exit(1);
  }

  const rows = (logs ?? []) as Array<SyncLogRow & { account_id: string }>;
  console.log(`Read ${rows.length} sync logs with a phone.`);

  // Per account: a phone is only unique inside one tenant, and the
  // contact update has to be scoped the same way.
  const byAccount = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byAccount.get(row.account_id) ?? [];
    list.push(row);
    byAccount.set(row.account_id, list);
  }

  let recovered = 0;
  let matched = 0;
  let written = 0;
  const unmappedAds = new Set<string>();

  for (const [accountId, accountLogs] of byAccount) {
    const refs = latestRefsByPhone(accountLogs);
    recovered += refs.size;
    if (refs.size === 0) continue;

    for (const ref of refs.values()) {
      const phone = normalizePhoneWithCountryCode(ref.phone);
      if (!phone) continue;

      const { data: contact } = await supabase
        .from('contacts')
        .select('id, name, lead_portal_listing_id')
        .eq('account_id', accountId)
        .eq('phone', phone)
        .maybeSingle();

      if (!contact) continue;
      matched++;
      if (contact.lead_portal_listing_id) continue;

      unmappedAds.add(`${ref.portal}:${ref.listingId}`);
      console.log(
        `${apply ? 'set  ' : 'would'} ${contact.name || phone} → ${ref.portal} ad ${ref.listingId}`
      );

      if (!apply) continue;
      const { error: updateErr } = await supabase
        .from('contacts')
        .update({
          lead_portal: ref.portal,
          lead_portal_listing_id: ref.listingId,
        })
        .eq('id', contact.id)
        .eq('account_id', accountId);
      if (updateErr) {
        console.error(`  failed: ${updateErr.message}`);
        continue;
      }
      written++;
    }
  }

  console.log(
    `\n${recovered} ad references recovered, ${matched} matched a contact, ` +
      `${apply ? `${written} written` : `${unmappedAds.size} distinct ads would appear in the queue`}.`
  );
  if (!apply) console.log('Preview only — re-run with --apply to write.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
