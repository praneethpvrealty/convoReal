import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { getPlanLimits } from '@/lib/billing/gates';
import { resolvePropertyRefs } from '@/lib/contacts/property-reference';

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
      name_tag?: string;
      email?: string;
      company?: string;
      tags?: string;
      areas_of_interest?: string;
      min_budget?: number;
      max_budget?: number;
      notes?: string;
      property_ref?: string;
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

    // Resolve every enquired-property reference up front — one bulk
    // pass rather than a lookup per row. A reference that resolves to
    // nothing leaves the lead unlinked; it never fails the import.
    const propertyRefs = rowsToImport
      .map((r) => r.property_ref)
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const resolvedProperties =
      propertyRefs.length > 0
        ? await resolvePropertyRefs(ctx.supabase, ctx.accountId, propertyRefs)
        : new Map<string, string>();
    const unresolvedRefs = new Set(
      propertyRefs.filter((ref) => !resolvedProperties.has(ref.trim())),
    );

    let imported = 0;
    let failed = 0;
    let propertiesLinked = 0;
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

      const enquiredPropertyId = row.property_ref
        ? (resolvedProperties.get(row.property_ref.trim()) ?? null)
        : null;

      const contactData = {
        user_id: ctx.userId,
        account_id: ctx.accountId,
        phone: row.phone.trim(),
        last_inquired_property_id: enquiredPropertyId,
        name: typeof row.name === 'string' ? row.name.trim() || null : null,
        name_tag: typeof row.name_tag === 'string' ? row.name_tag.trim() || null : null,
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

      // Same record the portal email webhook writes, so an imported
      // lead and an emailed one are indistinguishable downstream.
      if (enquiredPropertyId) {
        const { error: inquiryErr } = await ctx.supabase
          .from('contact_property_inquiries')
          .upsert(
            {
              contact_id: contactId,
              property_id: enquiredPropertyId,
              inquiry_source: 'CSV Import',
            },
            { onConflict: 'contact_id,property_id' },
          );
        if (!inquiryErr) propertiesLinked++;
      }

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

    // Preference extraction is driven by the client in batches of 25
    // (extract-preferences caps contactIds per request) — a server-side
    // self-fetch here carries no session cookie, so it can never
    // authenticate.
    return NextResponse.json({
      imported,
      failed,
      skipped,
      total: rows.length,
      importedIds,
      propertiesLinked,
      // Named so the client can tell "no property column" apart from
      // "the column was there but nothing matched inventory".
      propertiesUnresolved: unresolvedRefs.size,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
