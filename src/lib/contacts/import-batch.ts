// Turns raw CSV rows into the shape a batched import writes.
//
// The row-at-a-time importer cost ~7 sequential round trips per row —
// contact write, inquiry upsert, a tag lookup plus join insert per tag,
// note insert. On a 500-lead portal export that is ~3,500 queries, which
// is a timeout rather than a slow import.
//
// Nothing here talks to the database. It collapses the file into one
// record per phone number and hands back flat lists the route can write
// in a handful of statements.

import {
  buildExistingContactPatch,
  type IncomingContactFields,
} from './import-merge';

export interface ImportRow {
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

export interface PreparedImportRow {
  /** What this row is matched on — the uploaded number's digits, or
   *  `email:<lowercased>` for a row that carries an address and no
   *  number. Unique across a prepared import, so the route can map
   *  written contacts back to their row. */
  key: string;
  /** The number exactly as uploaded, which is what gets stored. Null
   *  for an email-only row (a company mailbox). */
  phone: string | null;
  fields: IncomingContactFields;
  tags: string[];
  notes: string[];
}

export interface PreparedImport {
  prepared: PreparedImportRow[];
  /** Rows carrying neither a phone number nor an email. They can never
   *  be written — `contacts_phone_or_email` would refuse them. */
  invalid: number;
  /** Rows folded into an earlier row for the same identity. */
  merged: number;
}

/**
 * How a row — uploaded or already on file — is matched.
 *
 * Phone first, because it is the identity the whole Engine turns on and
 * the only one a message can be sent to. An email-only row keys on its
 * address instead, which is all a company mailbox has.
 */
export function importRowKey(row: {
  phone?: string | null;
  email?: string | null;
}): string | null {
  const phone = row.phone?.trim();
  if (phone) return phone.replace(/\D/g, '') || phone;
  const email = row.email?.trim().toLowerCase();
  return email ? `email:${email}` : null;
}

function splitList(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

/**
 * One record per identity, in first-appearance order.
 *
 * A file that names the same person twice used to insert once and then
 * update, so the same fill-blanks rule is applied here instead — the
 * later row tops up what the earlier one left empty and always wins on
 * the enquired property.
 */
export function prepareImportRows(
  rows: readonly ImportRow[],
  resolvePropertyId: (ref: string) => string | null
): PreparedImport {
  const byKey = new Map<string, PreparedImportRow>();
  const order: string[] = [];
  let invalid = 0;
  let merged = 0;

  for (const row of rows) {
    const phone = typeof row.phone === 'string' ? row.phone.trim() : '';
    const key = importRowKey({ phone, email: row.email });
    if (!key) {
      invalid++;
      continue;
    }

    const fields: IncomingContactFields = {
      name: text(row.name),
      name_tag: text(row.name_tag),
      email: text(row.email),
      company: text(row.company),
      min_budget: typeof row.min_budget === 'number' ? row.min_budget : null,
      max_budget: typeof row.max_budget === 'number' ? row.max_budget : null,
      areas_of_interest: splitList(row.areas_of_interest),
      last_inquired_property_id:
        typeof row.property_ref === 'string' && row.property_ref.trim()
          ? resolvePropertyId(row.property_ref.trim())
          : null,
    };

    const tags = splitList(row.tags);
    const note = text(row.notes);

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        phone: phone || null,
        fields,
        tags: dedupeTags(tags),
        notes: note ? [note] : [],
      });
      order.push(key);
      continue;
    }

    merged++;
    // Same rule the route applies to a contact already on file: the
    // patch only carries what the earlier row left blank, plus a fresher
    // enquired property.
    const patch = buildExistingContactPatch(existing.fields, fields);
    existing.fields = {
      ...existing.fields,
      ...patch,
    } as IncomingContactFields;
    existing.tags = dedupeTags([...existing.tags, ...tags]);
    if (note) existing.notes.push(note);
  }

  return {
    prepared: order.map((key) => byKey.get(key)!),
    invalid,
    merged,
  };
}

/** Case-insensitive, first spelling wins — tags are matched with ilike. */
export function dedupeTags(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Every distinct tag in the upload, so each is looked up once. */
export function distinctTagNames(rows: readonly PreparedImportRow[]): string[] {
  return dedupeTags(rows.flatMap((r) => r.tags));
}
