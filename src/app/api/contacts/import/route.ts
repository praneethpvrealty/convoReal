import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getPlanLimits } from '@/lib/billing/gates';

// POST /api/contacts/import — bulk import contacts from a CSV payload.
//
// Two-phase flow:
//   Phase 1 (preflight): Client sends { rows, preflight: true }.
//     Server returns { canImport, maxImportable, currentCount, limit }
//     so the client can warn the user before committing.
//   Phase 2 (commit): Client sends { rows } (no preflight flag).
//     Server imports up to `maxImportable` rows in batches of 100.
//
// This replaces the client-side loop in import-modal.tsx that fired
// individual INSERT requests from the browser.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `agent:importContacts:${ctx.userId}`,
      { limit: 10, windowMs: 60_000 }, // 10 imports/minute — generous for batch ops
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json(
        { error: "'rows' must be a non-empty array" },
        { status: 400 },
      );
    }

    const rows: Array<{ phone?: string; name?: string; email?: string; company?: string }> = body.rows;
    const isPreflight = body.preflight === true;

    // Check plan limits
    const limits = await getPlanLimits(ctx);
    const maxContacts = limits.max_contacts;

    const { count: currentCountRaw } = await ctx.supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId);

    const currentCount = currentCountRaw ?? 0;
    const slotsAvailable = Math.max(0, maxContacts - currentCount);
    const maxImportable = maxContacts >= 999999 ? rows.length : Math.min(rows.length, slotsAvailable);

    // Phase 1: Preflight — return capacity info for the warning dialog
    if (isPreflight) {
      return NextResponse.json({
        canImport: maxImportable > 0,
        maxImportable,
        totalRequested: rows.length,
        currentCount,
        limit: maxContacts,
        willExceedLimit: rows.length > slotsAvailable && maxContacts < 999999,
      });
    }

    // Phase 2: Commit — actually import the rows
    if (maxImportable === 0) {
      return NextResponse.json(
        {
          error: `You've reached the ${maxContacts} contact limit on your plan`,
          imported: 0,
          skipped: rows.length,
        },
        { status: 402 },
      );
    }

    const rowsToImport = rows.slice(0, maxImportable);
    const skipped = rows.length - rowsToImport.length;

    let imported = 0;
    let failed = 0;
    const CHUNK_SIZE = 100;

    for (let i = 0; i < rowsToImport.length; i += CHUNK_SIZE) {
      const chunk = rowsToImport.slice(i, i + CHUNK_SIZE);
      const insertRows = chunk
        .filter((row) => typeof row.phone === 'string' && row.phone.trim().length > 0)
        .map((row) => ({
          user_id: ctx.userId,
          account_id: ctx.accountId,
          phone: row.phone!.trim(),
          name: typeof row.name === 'string' ? row.name.trim() || null : null,
          email: typeof row.email === 'string' ? row.email.trim() || null : null,
          company: typeof row.company === 'string' ? row.company.trim() || null : null,
        }));

      if (insertRows.length === 0) continue;

      const { data, error } = await ctx.supabase
        .from('contacts')
        .insert(insertRows)
        .select('id');

      if (error) {
        // Batch failed — try individual inserts to salvage what we can
        for (const row of insertRows) {
          const { error: singleErr } = await ctx.supabase
            .from('contacts')
            .insert(row);
          if (singleErr) {
            failed++;
          } else {
            imported++;
          }
        }
      } else {
        imported += data?.length ?? insertRows.length;
      }
    }

    return NextResponse.json({
      imported,
      failed,
      skipped,
      total: rows.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
