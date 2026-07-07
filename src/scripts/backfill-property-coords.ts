/**
 * One-time backfill: geocode existing properties that have no coordinates
 * so tiered location search (exact locality → nearby by radius) covers
 * the whole inventory, not just newly saved listings.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-property-coords.ts            # run
 *   npx tsx src/scripts/backfill-property-coords.ts --dry-run  # preview only
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_MAPS_API_KEY
 *
 * Idempotent — only touches rows where latitude IS NULL and location is
 * non-empty. Re-running skips already-geocoded rows. Rate-limited to
 * ~10 requests/second (Geocoding API default quota is 50 QPS).
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { geocodeAddress } from '../lib/maps/google-places';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE environment variables.');
  process.exit(1);
}
if (!process.env.GOOGLE_MAPS_API_KEY) {
  console.error('Missing GOOGLE_MAPS_API_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { data: rows, error } = await supabase
    .from('properties')
    .select('id, location, sublocality, city, state')
    .is('latitude', null)
    .not('location', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch properties:', error);
    process.exit(1);
  }

  const candidates = (rows || []).filter((r) => (r.location || '').trim());
  console.log(`${candidates.length} properties need geocoding${dryRun ? ' (dry run)' : ''}.`);

  let ok = 0;
  let failed = 0;

  for (const [i, row] of candidates.entries()) {
    // Prefer the most specific stable parts; location already usually
    // contains sublocality/city/state, but append them when absent.
    const parts = [row.location.trim()];
    if (row.city && !row.location.toLowerCase().includes(row.city.toLowerCase())) {
      parts.push(row.city.trim());
    }
    if (row.state && !row.location.toLowerCase().includes(row.state.toLowerCase())) {
      parts.push(row.state.trim());
    }
    const address = parts.join(', ');

    try {
      if (dryRun) {
        console.log(`[dry] would geocode ${row.id}: "${address}"`);
        continue;
      }

      const geo = await geocodeAddress(address);
      if (!geo) {
        console.warn(`  ✗ ${row.id}: no geocode result for "${address}"`);
        failed++;
      } else {
        const { error: updateErr } = await supabase
          .from('properties')
          .update({
            latitude: geo.latitude,
            longitude: geo.longitude,
            locality_place_id: geo.place_id,
          })
          .eq('id', row.id);
        if (updateErr) {
          console.error(`  ✗ ${row.id}: update failed:`, updateErr.message);
          failed++;
        } else {
          ok++;
          console.log(`  ✓ ${row.id}: ${geo.latitude.toFixed(5)},${geo.longitude.toFixed(5)}  (${address})`);
        }
      }
    } catch (err) {
      console.error(`  ✗ ${row.id}:`, err instanceof Error ? err.message : err);
      failed++;
    }

    if ((i + 1) % 10 === 0) await sleep(1000); // ~10 req/s
  }

  console.log(`Done. ${ok} geocoded, ${failed} failed, ${candidates.length - ok - failed} skipped.`);
}

main();
