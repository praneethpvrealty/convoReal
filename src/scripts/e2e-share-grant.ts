/**
 * End-to-end check for property share grants against a running server.
 *
 * The unit and component tests cover either side of the seam: the guard
 * decides correctly (location-guard.test.ts), a token's lifecycle is
 * right (share-grants.test.ts), and the flags reach the right JSX
 * (showcase-view.grant.test.tsx). What none of them can prove is the
 * seam itself — that `?g=<token>` on a real request reaches
 * resolveShareGrant, widens exactly one listing, and stops widening it
 * the moment the grant dies.
 *
 * This drives that path over HTTP. The showcase detail modal is part of
 * the server render (see findInitialProperty in showcase-view.tsx), so
 * the response HTML is the rendered result — no browser required, and
 * the assertions land on the server-side resolution rather than on
 * client hydration.
 *
 * Usage:
 *   npm run build && npm start &          # or: npm run dev
 *   npx tsx src/scripts/e2e-share-grant.ts
 *   npx tsx src/scripts/e2e-share-grant.ts --base-url=https://<preview>.vercel.app
 *   npx tsx src/scripts/e2e-share-grant.ts --property=<uuid>
 *
 * Requires in .env.local (or the environment):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Every row it writes is a share grant with a `E2EPROBE_` token prefix,
 * hard-deleted in a finally block. It never modifies a property.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const BASE_URL =
  arg('base-url') || process.env.E2E_BASE_URL || 'http://localhost:3000';
const TOKEN_PREFIX = 'E2EPROBE_';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function getHtml(path: string): Promise<string> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.text();
}

/** The rendered signals a granted page must / must not carry. */
const MASKED_MARKER = 'Exact Address Masked';
const MAP_MARKER = 'title="Property Location"';
const DOCS_MARKER = 'Property Documents (';
const PRIVATE_BUCKET = 'property-images-private';

function mintToken(suffix: string): string {
  return (TOKEN_PREFIX + suffix + crypto.randomUUID().replace(/-/g, '')).slice(
    0,
    48
  );
}

async function insertGrant(
  admin: SupabaseClient,
  row: Record<string, unknown>
): Promise<{ id: string; token: string }> {
  const { data, error } = await admin
    .from('property_share_grants')
    .insert(row)
    .select('id, token')
    .single();
  if (error) throw new Error(`grant insert failed: ${error.message}`);
  return data as { id: string; token: string };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Put them in .env.local or the environment, then re-run.'
    );
    process.exit(2);
  }

  const admin = createClient(url, serviceKey);

  // Reachability first — a connection refused here is the usual cause
  // of every later assertion failing for the wrong reason.
  try {
    await fetch(BASE_URL, { method: 'HEAD' });
  } catch {
    console.error(
      `Cannot reach ${BASE_URL}. Start the server (npm run dev, or\n` +
        'npm run build && npm start) or pass --base-url=<deployment>.'
    );
    process.exit(2);
  }

  // A listing with documents makes the richest assertion; guarded
  // photos are asserted only when the chosen listing actually has them.
  const explicitId = arg('property');
  const query = admin
    .from('properties')
    .select('id, account_id, title, type, documents, private_images')
    .limit(1);
  const { data: rows, error } = explicitId
    ? await query.eq('id', explicitId)
    : await query
        .not('documents', 'is', null)
        .order('created_at', { ascending: false });
  if (error) throw new Error(`property lookup failed: ${error.message}`);

  const property = rows?.[0] as
    | {
        id: string;
        account_id: string;
        title: string;
        type: string;
        documents: string[] | null;
        private_images: string[] | null;
      }
    | undefined;
  if (!property) {
    console.error('No property found to test against. Pass --property=<uuid>.');
    process.exit(2);
  }

  const docCount = (property.documents ?? []).filter((d) => d?.trim()).length;
  const imgCount = (property.private_images ?? []).filter((p) =>
    p?.trim()
  ).length;

  console.log(`\nTarget: ${property.title} (${property.type})`);
  console.log(`  ${property.id}`);
  console.log(`  documents: ${docCount}, guarded photos: ${imgCount}`);
  console.log(`Server: ${BASE_URL}\n`);

  const created: string[] = [];

  try {
    // ── 1. Baseline: no token, everything masked ────────────────
    console.log('1. Baseline (no ?g=)');
    const baseline = await getHtml(`/?property_id=${property.id}`);
    check('masked block rendered', baseline.includes(MASKED_MARKER));
    check('no map embed', !baseline.includes(MAP_MARKER));
    check('no documents list', !baseline.includes(DOCS_MARKER));
    check(
      'no guarded-photo proxy urls',
      !baseline.includes('/api/public/share-grant/')
    );

    // ── 2. Live grant widens exactly this listing ───────────────
    console.log('\n2. Live grant');
    const live = await insertGrant(admin, {
      account_id: property.account_id,
      property_id: property.id,
      token: mintToken('live'),
      reveal_location: true,
      reveal_documents: docCount > 0,
      reveal_private_images: imgCount > 0,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    created.push(live.id);

    const granted = await getHtml(
      `/?property_id=${property.id}&g=${live.token}`
    );
    check('map embed rendered', granted.includes(MAP_MARKER));
    check('masked block stood down', !granted.includes(MASKED_MARKER));
    if (docCount > 0) {
      check('documents listed', granted.includes(DOCS_MARKER));
    }
    if (imgCount > 0) {
      check(
        'guarded photos addressed via proxy',
        granted.includes(`/api/public/share-grant/${live.token}/image/0`)
      );
    }
    check(
      'private bucket paths never rendered',
      !granted.includes(PRIVATE_BUCKET)
    );

    // ── 3. The guarded-photo proxy honours the token ────────────
    if (imgCount > 0) {
      console.log('\n3. Guarded-photo proxy');
      const ok = await fetch(
        `${BASE_URL}/api/public/share-grant/${live.token}/image/0`
      );
      check(
        'serves image for a live grant',
        ok.status === 200,
        `got ${ok.status}`
      );
      check(
        'served as an image',
        (ok.headers.get('content-type') || '').startsWith('image/'),
        ok.headers.get('content-type') || 'no content-type'
      );
      const oob = await fetch(
        `${BASE_URL}/api/public/share-grant/${live.token}/image/99`
      );
      check(
        '404s an out-of-range index',
        oob.status === 404,
        `got ${oob.status}`
      );
    } else {
      console.log(
        '\n3. Guarded-photo proxy — skipped (listing has no private photos)'
      );
    }

    // ── 4. A token cannot widen a different listing ─────────────
    console.log('\n4. Cross-property scoping');
    const { data: other } = await admin
      .from('properties')
      .select('id')
      .neq('id', property.id)
      .limit(1)
      .maybeSingle();
    if (other?.id) {
      const wrong = await getHtml(`/?property_id=${other.id}&g=${live.token}`);
      check('other listing stays masked', wrong.includes(MASKED_MARKER));
      check('other listing gets no map', !wrong.includes(MAP_MARKER));
    } else {
      console.log('  – skipped (no second property to test against)');
    }

    // ── 5. Revoked and expired grants reveal nothing ────────────
    console.log('\n5. Dead grants');
    await admin
      .from('property_share_grants')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', live.id);

    const afterRevoke = await getHtml(
      `/?property_id=${property.id}&g=${live.token}`
    );
    check(
      'revoked grant re-masks the page',
      afterRevoke.includes(MASKED_MARKER)
    );
    check('revoked grant drops the map', !afterRevoke.includes(MAP_MARKER));
    if (imgCount > 0) {
      const gone = await fetch(
        `${BASE_URL}/api/public/share-grant/${live.token}/image/0`
      );
      check(
        'proxy refuses a revoked token',
        gone.status === 410 || gone.status === 404,
        `got ${gone.status}`
      );
    }

    const expired = await insertGrant(admin, {
      account_id: property.account_id,
      property_id: property.id,
      token: mintToken('expired'),
      reveal_location: true,
      reveal_documents: docCount > 0,
      reveal_private_images: false,
      expires_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    created.push(expired.id);

    const afterExpiry = await getHtml(
      `/?property_id=${property.id}&g=${expired.token}`
    );
    check('expired grant reveals nothing', afterExpiry.includes(MASKED_MARKER));
    check('expired grant drops the map', !afterExpiry.includes(MAP_MARKER));

    // ── 6. Garbage tokens are inert ─────────────────────────────
    console.log('\n6. Bogus tokens');
    for (const bogus of ['x', 'z'.repeat(48), '../../etc/passwd']) {
      const junk = await getHtml(
        `/?property_id=${property.id}&g=${encodeURIComponent(bogus)}`
      );
      check(
        `"${bogus.slice(0, 12)}" reveals nothing`,
        junk.includes(MASKED_MARKER) && !junk.includes(MAP_MARKER)
      );
    }
  } finally {
    // Always clean up, including on a failed assertion or a throw.
    const { error: cleanupError } = await admin
      .from('property_share_grants')
      .delete()
      .like('token', `${TOKEN_PREFIX}%`);
    const { count } = await admin
      .from('property_share_grants')
      .select('id', { count: 'exact', head: true })
      .like('token', `${TOKEN_PREFIX}%`);
    console.log(
      `\nCleanup: ${cleanupError ? `FAILED — ${cleanupError.message}` : 'probe grants deleted'}` +
        ` (${count ?? '?'} remaining)`
    );
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nE2E run failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
