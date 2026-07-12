import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getImageCleanupConfig } from '@/lib/storage/image-cleanup-config';
import { runImageCleanup } from '@/lib/storage/image-cleanup';

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Property image cleanup cron — drives the staged, reversible lifecycle in
 * src/lib/storage/image-cleanup.ts (warn → dereference → optional purge).
 * DESTRUCTIVE and cross-tenant, so it must never be publicly triggerable and
 * ships inert (config `enabled:false`, `dry_run:true`) until an operator opts
 * in via the `image_cleanup_config` system setting.
 *
 * Auth: constant-time check of the shared cron secret, supplied via the
 * repo-standard `x-cron-secret` header OR Vercel Cron's native
 * `Authorization: Bearer` (this job is registered in vercel.json), matched
 * against `AUTOMATION_CRON_SECRET` or `CRON_SECRET`. Fails CLOSED (503) when
 * no secret is configured.
 */
export async function GET(request: Request) {
  const expected =
    process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await getImageCleanupConfig();
  if (!config.enabled) {
    return NextResponse.json({ skipped: 'disabled' });
  }

  try {
    const summary = await runImageCleanup(supabaseAdmin(), config);
    console.log('[cleanup-images]', JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cleanup-images] run failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
