/**
 * Reconciles stored property coordinates against the property's own
 * Google Maps pin. A pin is an exact point the lister placed; the
 * coordinates that were geocoded from address text are a guess, and a
 * guess that lands on a same-named locality across town (the "KHB
 * Colony" in Vijayanagar instead of the one in Koramangala) quietly
 * drops the listing out of every radius search.
 *
 * Usage:
 *   npx tsx src/scripts/reconcile-property-pins.ts            # apply
 *   npx tsx src/scripts/reconcile-property-pins.ts --dry-run  # preview
 *   npx tsx src/scripts/reconcile-property-pins.ts --min-km=2 # only bigger drifts
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Idempotent — a row already sitting on its pin is left alone. Short
 * `maps.app.goo.gl` links cost one redirect each, so the run is paced
 * at ~5 links/second.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { haversineKm } from '../lib/geo';
import { resolveCoordinatesFromMapLink } from '../lib/maps/resolve-location';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');
const minKmArg = process.argv.find((a) => a.startsWith('--min-km='));
const minKm = minKmArg ? Number(minKmArg.split('=')[1]) : 0.5;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE environment variables.');
  process.exit(1);
}
if (!Number.isFinite(minKm) || minKm < 0) {
  console.error('--min-km must be a non-negative number.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { data: rows, error } = await supabase
    .from('properties')
    .select('id, property_code, title, latitude, longitude, google_map_link')
    .not('google_map_link', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch properties:', error);
    process.exit(1);
  }

  const candidates = (rows || []).filter((r) => (r.google_map_link || '').trim());
  console.log(
    `${candidates.length} properties carry a map link; drift threshold ${minKm} km${dryRun ? ' (dry run)' : ''}.`
  );

  let moved = 0;
  let filled = 0;
  let agreed = 0;
  let unreadable = 0;

  for (const [i, row] of candidates.entries()) {
    const pin = await resolveCoordinatesFromMapLink(row.google_map_link!);
    if (!pin) {
      unreadable++;
    } else {
      const hasCoords = row.latitude != null && row.longitude != null;
      const driftKm = hasCoords
        ? haversineKm(Number(row.latitude), Number(row.longitude), pin.latitude, pin.longitude)
        : null;

      if (driftKm !== null && driftKm < minKm) {
        agreed++;
      } else {
        const label = `${row.property_code || row.id} ${String(row.title || '').slice(0, 40)}`;
        const move =
          driftKm === null
            ? 'no stored coordinates'
            : `${driftKm.toFixed(2)} km off its pin`;

        if (dryRun) {
          console.log(`[dry] ${label}: ${move} → ${pin.latitude},${pin.longitude}`);
        } else {
          const { error: updateErr } = await supabase
            .from('properties')
            .update({ latitude: pin.latitude, longitude: pin.longitude })
            .eq('id', row.id);
          if (updateErr) {
            console.error(`  ✗ ${label}: update failed:`, updateErr.message);
          } else {
            console.log(`  ✓ ${label}: ${move} → ${pin.latitude},${pin.longitude}`);
          }
        }
        if (driftKm === null) filled++;
        else moved++;
      }
    }

    if ((i + 1) % 5 === 0) await sleep(1000);
  }

  console.log(
    `Done. ${moved} moved onto their pin, ${filled} given coordinates, ${agreed} already agreed, ${unreadable} links carried no coordinates.`
  );
}

main();
