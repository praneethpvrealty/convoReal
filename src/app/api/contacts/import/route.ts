import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { getPlanLimits } from '@/lib/billing/gates';
import { resolvePropertyRefs } from '@/lib/contacts/property-reference';
import { buildExistingContactPatch } from '@/lib/contacts/import-merge';
import {
  prepareImportRows,
  distinctTagNames,
  type ImportRow,
  type PreparedImportRow,
} from '@/lib/contacts/import-batch';
import type { SupabaseClient } from '@supabase/supabase-js';

interface ExistingContactRow {
  id: string;
  phone: string | null;
  name: string | null;
  name_tag: string | null;
  email: string | null;
  company: string | null;
  min_budget: number | null;
  max_budget: number | null;
  areas_of_interest: string[] | null;
  last_inquired_property_id: string | null;
}

/**
 * The account's existing contacts for the uploaded numbers, keyed on
 * digits so a stored "+919876543210" matches an uploaded "919876543210".
 * Every spelling is queried because rows created before E.164
 * normalisation are still out there.
 */
async function loadExistingByPhone(
  ctx: { supabase: SupabaseClient; accountId: string },
  phones: readonly string[]
): Promise<Map<string, { id: string; row: ExistingContactRow }>> {
  const byPhone = new Map<string, { id: string; row: ExistingContactRow }>();
  if (phones.length === 0) return byPhone;

  const variants = [
    ...new Set(
      phones.flatMap((p) => {
        const digits = p.replace(/\D/g, '');
        return digits ? [p, digits, `+${digits}`] : [p];
      })
    ),
  ];

  const { data } = await ctx.supabase
    .from('contacts')
    .select(
      'id, phone, name, name_tag, email, company, min_budget, max_budget, areas_of_interest, last_inquired_property_id'
    )
    .eq('account_id', ctx.accountId)
    .in('phone', variants);

  for (const c of (data ?? []) as ExistingContactRow[]) {
    const key = (c.phone ?? '').replace(/\D/g, '');
    if (key && !byPhone.has(key)) byPhone.set(key, { id: c.id, row: c });
  }
  return byPhone;
}

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

    const limit = checkRateLimit(`agent:importContacts:${ctx.userId}`, {
      limit: 10,
      windowMs: 60_000,
    });
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json(
        { error: "'rows' must be a non-empty array" },
        { status: 400 }
      );
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

    // Contacts this account already holds for the uploaded numbers. A
    // re-engagement list overlaps the book it came from, and inserting
    // blindly would give one person two contact rows and two copies of
    // the same message. Bounded by the upload, and matched on every
    // stored spelling because older rows predate E.164 normalisation.
    const existingByPhone = await loadExistingByPhone(
      ctx,
      rows
        .map((r) => (typeof r.phone === 'string' ? r.phone.trim() : ''))
        .filter(Boolean)
    );

    // Only a genuinely new contact consumes a plan slot, so the limit is
    // applied to those alone — otherwise re-importing a list the account
    // already has would be refused for occupying seats it never takes.
    const isNew = (r: ImportRow) =>
      typeof r.phone === 'string' &&
      !existingByPhone.has(r.phone.trim().replace(/\D/g, ''));
    const newRowCount = rows.filter(isNew).length;
    const unlimited = maxContacts >= 999999;
    const maxNewImportable = unlimited
      ? newRowCount
      : Math.min(newRowCount, slotsAvailable);

    // Phase 1: Preflight
    if (isPreflight) {
      return NextResponse.json({
        canImport: maxNewImportable > 0 || newRowCount < rows.length,
        maxImportable: maxNewImportable,
        totalRequested: rows.length,
        currentCount,
        limit: maxContacts,
        willExceedLimit: !unlimited && newRowCount > slotsAvailable,
        // Existing numbers are enriched in place, never duplicated.
        alreadyInEngine: rows.length - newRowCount,
      });
    }

    // Phase 2: Commit. Rows for numbers already held are always
    // processed — they cost no slot — while new ones stop at the cap.
    let newBudget = maxNewImportable;
    const rowsToImport = rows.filter((r) => {
      if (!isNew(r)) return true;
      if (newBudget <= 0) return false;
      newBudget--;
      return true;
    });
    const skipped = rows.length - rowsToImport.length;

    if (rowsToImport.length === 0) {
      return NextResponse.json(
        {
          error: `You've reached the ${maxContacts} contact limit on your plan`,
          imported: 0,
          skipped: rows.length,
        },
        { status: 402 }
      );
    }

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
      propertyRefs.filter((ref) => !resolvedProperties.has(ref.trim()))
    );

    // One record per number, so a file naming someone twice writes one
    // contact instead of an insert followed by an update.
    const { prepared, invalid, merged } = prepareImportRows(
      rowsToImport,
      (ref) => resolvedProperties.get(ref) ?? null
    );

    let imported = 0;
    // A folded duplicate did enrich the record the first row created,
    // which is what `updated` has always meant here — counting it keeps
    // imported + updated + failed + skipped equal to the row count.
    let updated = merged;
    let failed = invalid;
    let propertiesLinked = 0;
    const importedIds: string[] = [];
    const updatedIds: string[] = [];

    const toInsert: PreparedImportRow[] = [];
    const toUpdate: { prep: PreparedImportRow; id: string }[] = [];
    for (const prep of prepared) {
      const existing = existingByPhone.get(prep.phoneKey);
      if (existing) toUpdate.push({ prep, id: existing.id });
      else toInsert.push(prep);
    }

    const contactIdByPhone = new Map<string, string>();

    const insertPayload = (prep: PreparedImportRow) => ({
      user_id: ctx.userId,
      account_id: ctx.accountId,
      phone: prep.phone,
      classification: 'Buyer' as const, // Default to Buyer
      ...prep.fields,
    });

    if (toInsert.length > 0) {
      // Phone strings are unique across prepared records, so the
      // returned rows map back without relying on statement ordering.
      const { data: created, error: insertErr } = await ctx.supabase
        .from('contacts')
        .insert(toInsert.map(insertPayload))
        .select('id, phone');

      if (!insertErr && created) {
        for (const c of created as { id: string; phone: string }[]) {
          contactIdByPhone.set(c.phone, c.id);
        }
      } else {
        // One bad row rejects the whole statement, so fall back to
        // single inserts and let only the offending rows fail. Re-read
        // first: a statement that committed but failed to answer would
        // otherwise be inserted twice, and a duplicated contact means a
        // duplicated message.
        console.error(
          '[POST /api/contacts/import] Batched insert failed, retrying row by row:',
          insertErr
        );
        const landed = await loadExistingByPhone(
          ctx,
          toInsert.map((p) => p.phone)
        );
        for (const prep of toInsert) {
          const already = landed.get(prep.phoneKey);
          if (already) {
            contactIdByPhone.set(prep.phone, already.id);
            continue;
          }

          const { data: one, error: oneErr } = await ctx.supabase
            .from('contacts')
            .insert(insertPayload(prep))
            .select('id')
            .single();
          if (oneErr || !one) {
            console.error(
              '[POST /api/contacts/import] Insert error for row:',
              prep.phone,
              oneErr
            );
            continue;
          }
          contactIdByPhone.set(prep.phone, one.id);
        }
      }

      for (const prep of toInsert) {
        const id = contactIdByPhone.get(prep.phone);
        if (!id) {
          failed++;
          continue;
        }
        importedIds.push(id);
        imported++;
      }
    }

    // Each patch differs, so these stay one statement per contact —
    // rows that add nothing are skipped entirely.
    for (const { prep, id } of toUpdate) {
      const existing = existingByPhone.get(prep.phoneKey)!;
      const patch = buildExistingContactPatch(existing.row, prep.fields);

      if (Object.keys(patch).length > 0) {
        const { data: patched, error: updateErr } = await ctx.supabase
          .from('contacts')
          .update(patch)
          .eq('id', id)
          .eq('account_id', ctx.accountId)
          .select('id');
        if (updateErr || !patched?.length) {
          console.error(
            '[POST /api/contacts/import] Update error for row:',
            prep.phone,
            updateErr
          );
          failed++;
          continue;
        }
      }
      contactIdByPhone.set(prep.phone, id);
      updatedIds.push(id);
      updated++;
    }

    const written = prepared.filter((p) => contactIdByPhone.has(p.phone));

    // Same record the portal email webhook writes, so an imported lead
    // and an emailed one are indistinguishable downstream. One record
    // per number means no pair repeats, which a single upsert requires.
    const inquiries = written
      .filter((p) => p.fields.last_inquired_property_id)
      .map((p) => ({
        contact_id: contactIdByPhone.get(p.phone)!,
        property_id: p.fields.last_inquired_property_id!,
        inquiry_source: 'CSV Import',
      }));
    if (inquiries.length > 0) {
      const { error: inquiryErr } = await ctx.supabase
        .from('contact_property_inquiries')
        .upsert(inquiries, { onConflict: 'contact_id,property_id' });
      if (inquiryErr) {
        console.error(
          '[POST /api/contacts/import] Inquiry upsert failed:',
          inquiryErr
        );
      } else {
        propertiesLinked = inquiries.length;
      }
    }

    // A re-engagement batch tags every row the same way, so resolving
    // the distinct names once replaces a lookup per row with a handful.
    const tagIdByName = new Map<string, string>();
    for (const tagName of distinctTagNames(written)) {
      const { data: existingTag } = await ctx.supabase
        .from('tags')
        .select('id')
        .eq('account_id', ctx.accountId)
        .ilike('name', tagName)
        .maybeSingle();

      if (existingTag) {
        tagIdByName.set(tagName.toLowerCase(), existingTag.id);
        continue;
      }

      const { data: newTag } = await ctx.supabase
        .from('tags')
        .insert({
          account_id: ctx.accountId,
          user_id: ctx.userId,
          name: tagName,
        })
        .select('id')
        .single();
      if (newTag) tagIdByName.set(tagName.toLowerCase(), newTag.id);
    }

    const tagLinks = written.flatMap((p) =>
      p.tags
        .map((name) => tagIdByName.get(name.toLowerCase()))
        .filter((tagId): tagId is string => Boolean(tagId))
        .map((tagId) => ({
          contact_id: contactIdByPhone.get(p.phone)!,
          tag_id: tagId,
        }))
    );
    if (tagLinks.length > 0) {
      // A contact already carrying the tag would reject the statement,
      // and re-tagging an existing lead is the normal case here.
      const { error: tagErr } = await ctx.supabase
        .from('contact_tags')
        .upsert(tagLinks, {
          onConflict: 'contact_id,tag_id',
          ignoreDuplicates: true,
        });
      if (tagErr) {
        console.error('[POST /api/contacts/import] Tag link failed:', tagErr);
      }
    }

    const noteRows = written.flatMap((p) =>
      p.notes.map((note) => ({
        contact_id: contactIdByPhone.get(p.phone)!,
        user_id: ctx.userId,
        account_id: ctx.accountId,
        note_text: note,
      }))
    );
    if (noteRows.length > 0) {
      const { error: noteErr } = await ctx.supabase
        .from('contact_notes')
        .insert(noteRows);
      if (noteErr) {
        console.error(
          '[POST /api/contacts/import] Note insert failed:',
          noteErr
        );
      }
    }

    // Preference extraction is driven by the client in batches of 25
    // (extract-preferences caps contactIds per request) — a server-side
    // self-fetch here carries no session cookie, so it can never
    // authenticate.
    return NextResponse.json({
      imported,
      // Numbers this account already had: enriched in place rather than
      // duplicated. They still get the row's tags and notes, so a
      // re-engagement batch still reaches them.
      updated,
      failed,
      skipped,
      total: rows.length,
      importedIds,
      updatedIds,
      propertiesLinked,
      // Named so the client can tell "no property column" apart from
      // "the column was there but nothing matched inventory".
      propertiesUnresolved: unresolvedRefs.size,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
