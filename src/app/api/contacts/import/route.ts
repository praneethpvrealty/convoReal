import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
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
      { limit: 10, windowMs: 60_000 },
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json(
        { error: "'rows' must be a non-empty array" },
        { status: 400 },
      );
    }

    interface ImportRow {
      phone?: string;
      name?: string;
      email?: string;
      company?: string;
      tags?: string;
      areas_of_interest?: string;
      min_budget?: number;
      max_budget?: number;
      notes?: string;
    }

    const rows: ImportRow[] = body.rows;
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

    // Phase 1: Preflight
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

    // Phase 2: Commit
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
    const importedIds: string[] = [];

    for (const row of rowsToImport) {
      if (typeof row.phone !== 'string' || row.phone.trim().length === 0) {
        failed++;
        continue;
      }

      // Parse areas of interest
      let areas: string[] = [];
      if (typeof row.areas_of_interest === 'string' && row.areas_of_interest.trim()) {
        areas = row.areas_of_interest.split(',').map((a) => a.trim()).filter(Boolean);
      }

      const contactData = {
        user_id: ctx.userId,
        account_id: ctx.accountId,
        phone: row.phone.trim(),
        name: typeof row.name === 'string' ? row.name.trim() || null : null,
        email: typeof row.email === 'string' ? row.email.trim() || null : null,
        company: typeof row.company === 'string' ? row.company.trim() || null : null,
        classification: 'Buyer' as const, // Default to Buyer
        min_budget: typeof row.min_budget === 'number' ? row.min_budget : null,
        max_budget: typeof row.max_budget === 'number' ? row.max_budget : null,
        areas_of_interest: areas,
      };

      const { data: created, error: insertErr } = await ctx.supabase
        .from('contacts')
        .insert(contactData)
        .select('id')
        .single();

      if (insertErr || !created) {
        console.error('[POST /api/contacts/import] Insert error for row:', row.phone, insertErr);
        failed++;
        continue;
      }

      const contactId = created.id;
      importedIds.push(contactId);
      imported++;

      // Process tags
      if (typeof row.tags === 'string' && row.tags.trim()) {
        const tagNames = row.tags.split(',').map((t) => t.trim()).filter(Boolean);
        for (const tagName of tagNames) {
          let tagId: string | null = null;

          // Find existing tag scoped to account_id (case-insensitive)
          const { data: existingTag } = await ctx.supabase
            .from('tags')
            .select('id')
            .eq('account_id', ctx.accountId)
            .ilike('name', tagName)
            .maybeSingle();

          if (existingTag) {
            tagId = existingTag.id;
          } else {
            // Create tag
            const { data: newTag } = await ctx.supabase
              .from('tags')
              .insert({
                account_id: ctx.accountId,
                user_id: ctx.userId,
                name: tagName,
              })
              .select('id')
              .single();
            if (newTag) tagId = newTag.id;
          }

          if (tagId) {
            await ctx.supabase
              .from('contact_tags')
              .insert({
                contact_id: contactId,
                tag_id: tagId,
              });
          }
        }
      }

      // Process notes/preferences
      if (typeof row.notes === 'string' && row.notes.trim()) {
        await ctx.supabase
          .from('contact_notes')
          .insert({
            contact_id: contactId,
            user_id: ctx.userId,
            account_id: ctx.accountId,
            note_text: row.notes.trim(),
          });
      }
    }

    // Fire-and-forget: extract AI matching preferences in background
    if (importedIds.length > 0) {
      fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/contacts/extract-preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: importedIds }),
      }).catch(() => {});
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
