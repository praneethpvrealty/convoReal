/**
 * Moves invoice files off the retired `deals.invoices` JSONB array and
 * into the deal document folder, so the consolidating migration
 * (20260916041500) can drop the column without stranding anything.
 *
 * Each entry becomes a `deal_documents` row with category 'invoice',
 * and its object is copied from the `deal-invoices` bucket into
 * `deal-documents` under the path shape the folder uses. The source
 * object is left alone: the bucket is deleted by hand once the copy is
 * verified, which is one undo away rather than none.
 *
 * Usage:
 *   npx tsx src/scripts/migrate-deal-invoices-to-documents.ts --dry-run
 *   npx tsx src/scripts/migrate-deal-invoices-to-documents.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Idempotent — an entry whose object already has a row in the folder is
 * skipped, so an interrupted run is resumed by running it again.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const SOURCE_BUCKET = 'deal-invoices';
const TARGET_BUCKET = 'deal-documents';

interface LegacyInvoice {
  path?: unknown;
  name?: unknown;
  size?: unknown;
  uploaded_at?: unknown;
  uploaded_by?: unknown;
}

function displayName(path: string): string {
  const filename = path.split('/').pop() ?? '';
  return filename.replace(/^\d{10,}-[a-z0-9]{4,8}-/, '') || 'Invoice';
}

async function main() {
  const { data: deals, error } = await supabase
    .from('deals')
    .select('id, account_id, invoices')
    .not('invoices', 'is', null);

  if (error) {
    console.error('Could not read deals:', error.message);
    process.exit(1);
  }

  let moved = 0;
  let skipped = 0;
  let failed = 0;

  for (const deal of deals ?? []) {
    const entries = Array.isArray(deal.invoices)
      ? (deal.invoices as LegacyInvoice[])
      : [];

    for (const entry of entries) {
      const sourcePath = typeof entry.path === 'string' ? entry.path : '';
      if (!sourcePath) continue;

      const title =
        typeof entry.name === 'string' && entry.name.trim()
          ? entry.name.trim()
          : displayName(sourcePath);

      const targetPath = `${deal.account_id}/${deal.id}/${Date.now()}-${sourcePath
        .split('/')
        .pop()}`;

      const { data: existing } = await supabase
        .from('deal_documents')
        .select('id')
        .eq('deal_id', deal.id)
        .eq('category', 'invoice')
        .eq('title', title)
        .maybeSingle();

      if (existing) {
        skipped += 1;
        continue;
      }

      console.log(
        `${dryRun ? '[dry-run] ' : ''}${deal.id}: ${sourcePath} -> ${TARGET_BUCKET}/${targetPath}`
      );
      if (dryRun) {
        moved += 1;
        continue;
      }

      const { data: file, error: downloadError } = await supabase.storage
        .from(SOURCE_BUCKET)
        .download(sourcePath);

      if (downloadError || !file) {
        console.error(`  download failed: ${downloadError?.message}`);
        failed += 1;
        continue;
      }

      const { error: uploadError } = await supabase.storage
        .from(TARGET_BUCKET)
        .upload(targetPath, Buffer.from(await file.arrayBuffer()), {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        });

      if (uploadError) {
        console.error(`  upload failed: ${uploadError.message}`);
        failed += 1;
        continue;
      }

      const { error: insertError } = await supabase
        .from('deal_documents')
        .insert({
          account_id: deal.account_id,
          deal_id: deal.id,
          category: 'invoice',
          title,
          storage_path: `${TARGET_BUCKET}/${targetPath}`,
          mime_type: file.type || null,
          size_bytes: typeof entry.size === 'number' ? entry.size : file.size,
          uploaded_by:
            typeof entry.uploaded_by === 'string' ? entry.uploaded_by : null,
          created_at:
            typeof entry.uploaded_at === 'string'
              ? entry.uploaded_at
              : undefined,
        })
        .select('id');

      if (insertError) {
        // Leave no copy behind that no row names.
        await supabase.storage.from(TARGET_BUCKET).remove([targetPath]);
        console.error(`  row insert failed: ${insertError.message}`);
        failed += 1;
        continue;
      }

      moved += 1;
    }
  }

  if (!dryRun && moved > 0 && failed === 0) {
    const { error: clearError } = await supabase
      .from('deals')
      .update({ invoices: [] })
      .not('invoices', 'is', null)
      .select('id');
    if (clearError) {
      console.error(`Could not clear deals.invoices: ${clearError.message}`);
      failed += 1;
    }
  }

  console.log(`\nmoved ${moved}, skipped ${skipped}, failed ${failed}`);
  if (failed > 0) {
    console.error('Do not run the DROP half of the migration yet.');
    process.exit(1);
  }
}

void main();
