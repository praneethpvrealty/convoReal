// Client-side CSV contact import helpers, shared by the Contacts
// import dialog and the lead re-engage wizard. Parsing is pure; the
// extraction runner drives /api/contacts/extract-preferences from the
// browser because that endpoint caps contactIds at 25 per request.

import { suggestNameTagSplit } from '@/lib/contacts/name-tag-split';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';

export interface ParsedContactRow {
  phone: string;
  name?: string;
  name_tag?: string;
  email?: string;
  company?: string;
  tags?: string;
  areas_of_interest?: string;
  min_budget?: number;
  max_budget?: number;
  notes?: string;
  /** The property this lead originally enquired about, as whatever
   *  identifier the portal export carried — id, PROP- code, portal
   *  listing id or exact title. Resolved server-side. */
  property_ref?: string;
}

/**
 * Header names each field answers to. A MagicBricks / Housing / 99acres
 * CRM export is the common case and names nothing the way we do —
 * "Contact Number", "Customer Name", "Contact Message Details" — so the
 * aliases let those files upload untouched instead of being reshaped by
 * hand. First matching header wins, so the canonical name always beats
 * a portal alias when a file happens to carry both.
 */
const HEADER_ALIASES: Record<string, readonly string[]> = {
  phone: [
    'phone',
    'contact number',
    'contact no',
    'mobile',
    'mobile number',
    'mobile no',
    'phone number',
    'whatsapp',
    'whatsapp number',
  ],
  /** Merged into the phone when it carries no international prefix. */
  countryCode: ['country code', 'country_code', 'isd', 'isd code'],
  name: ['name', 'customer name', 'lead name', 'client name', 'full name'],
  nameTag: ['name_tag', 'name tag'],
  email: ['email', 'customer email', 'email id', 'email address'],
  company: ['company', 'organisation', 'organization'],
  tags: ['tags', 'tag'],
  areas: [
    'areas of interest',
    'areas_of_interest',
    'location',
    'locality',
    'preferred location',
  ],
  minBudget: ['min budget', 'min_budget', 'budget min', 'minimum budget'],
  maxBudget: [
    'max budget',
    'max_budget',
    'budget max',
    'maximum budget',
    // A portal export carries a single "Budget" column, which is the
    // ceiling the buyer stated.
    'budget',
  ],
  notes: [
    'notes',
    'preferences',
    'requirements',
    'contact message details',
    'message',
    'requirement',
    'comments',
  ],
  propertyRef: [
    'property_id',
    'property id',
    'property_code',
    'property code',
    'portal_listing_id',
    'portal listing id',
    'listing_id',
    'listing id',
    'property',
  ],
};

/** Split one CSV line, honouring quoted fields. */
function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Index of the column this field should read, or -1.
 *
 * When a file matches several aliases the populated one wins, not the
 * first. A MagicBricks export carries both an empty "Notes" column and
 * a "Contact Message Details" column holding every buyer's stated
 * requirement; taking "Notes" because it appears earlier in the alias
 * list would silently import blank requirements and leave the AI
 * preference extraction with nothing to read. Ties fall back to alias
 * order, so the canonical name still beats a portal alias.
 */
function pick(
  headers: readonly string[],
  field: keyof typeof HEADER_ALIASES,
  valueRows: readonly string[][]
): number {
  const candidates: number[] = [];
  for (const alias of HEADER_ALIASES[field]) {
    const i = headers.indexOf(alias);
    if (i >= 0 && !candidates.includes(i)) candidates.push(i);
  }
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return candidates[0];

  let best = candidates[0];
  let bestFilled = -1;
  for (const i of candidates) {
    let filled = 0;
    for (const row of valueRows) {
      if ((row[i] ?? '').replace(/["']/g, '').trim()) filled++;
    }
    if (filled > bestFilled) {
      bestFilled = filled;
      best = i;
    }
  }
  return best;
}

export function parseContactsCsv(text: string): ParsedContactRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = headerLine
    .split(',')
    // A CSV exported from Excel starts with a UTF-8 BOM, which would
    // otherwise make the very first header unmatchable.
    .map((h) => h.trim().replace(/^﻿/, '').toLowerCase().replace(/["']/g, ''));

  // Values are split before columns are chosen, because which column a
  // field reads can depend on which one actually carries data.
  const valueRows = lines
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(splitCsvLine);

  const phoneIdx = pick(headers, 'phone', valueRows);
  if (phoneIdx === -1) return [];

  const countryCodeIdx = pick(headers, 'countryCode', valueRows);
  const nameIdx = pick(headers, 'name', valueRows);
  const nameTagIdx = pick(headers, 'nameTag', valueRows);
  const emailIdx = pick(headers, 'email', valueRows);
  const companyIdx = pick(headers, 'company', valueRows);
  const tagsIdx = pick(headers, 'tags', valueRows);
  const areasIdx = pick(headers, 'areas', valueRows);
  const minBudgetIdx = pick(headers, 'minBudget', valueRows);
  const maxBudgetIdx = pick(headers, 'maxBudget', valueRows);
  const notesIdx = pick(headers, 'notes', valueRows);
  const propertyRefIdxRaw = pick(headers, 'propertyRef', valueRows);
  const propertyRefIdx = propertyRefIdxRaw >= 0 ? propertyRefIdxRaw : undefined;

  const rows: ParsedContactRow[] = [];
  for (const values of valueRows) {
    const rawPhone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!rawPhone) continue;

    // A portal export splits the number across two columns. Join them
    // unless the number already carries its own international prefix,
    // so "91" + "9876543210" does not become "91919876543210".
    const countryCode =
      countryCodeIdx >= 0
        ? values[countryCodeIdx]?.replace(/\D/g, '').trim()
        : '';
    const joined =
      countryCode &&
      !rawPhone.startsWith('+') &&
      !rawPhone.startsWith(countryCode)
        ? `+${countryCode}${rawPhone.replace(/\D/g, '')}`
        : rawPhone;
    const phone = normalizePhoneWithCountryCode(joined) || joined;

    const minBudgetRaw =
      minBudgetIdx >= 0
        ? values[minBudgetIdx]?.replace(/["']/g, '').trim()
        : undefined;
    const maxBudgetRaw =
      maxBudgetIdx >= 0
        ? values[maxBudgetIdx]?.replace(/["']/g, '').trim()
        : undefined;

    const rawName =
      nameIdx >= 0
        ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined
        : undefined;
    const explicitTag =
      nameTagIdx >= 0
        ? values[nameTagIdx]?.replace(/["']/g, '').trim() || undefined
        : undefined;
    // No explicit tag column → suggest splitting a trailing qualifier off the
    // name ("Nataraj Bank DSA" → "Nataraj" + tag "Bank DSA").
    const split = !explicitTag && rawName ? suggestNameTagSplit(rawName) : null;

    rows.push({
      phone,
      name: split ? split.name : rawName,
      name_tag: explicitTag ?? split?.nameTag ?? undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tags:
        tagsIdx >= 0
          ? values[tagsIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      areas_of_interest:
        areasIdx >= 0
          ? values[areasIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      min_budget:
        minBudgetRaw && !isNaN(Number(minBudgetRaw))
          ? Number(minBudgetRaw)
          : undefined,
      max_budget:
        maxBudgetRaw && !isNaN(Number(maxBudgetRaw))
          ? Number(maxBudgetRaw)
          : undefined,
      notes:
        notesIdx >= 0
          ? values[notesIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      property_ref:
        propertyRefIdx !== undefined
          ? values[propertyRefIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
    });
  }

  return dedupeByPhone(rows);
}

/**
 * One row per number. A portal export repeats a lead once per enquiry —
 * 703 rows for 506 people in a real MagicBricks file — and importing
 * those verbatim would create a contact each time and message the same
 * person repeatedly.
 *
 * The first occurrence wins and later ones only fill blanks it left, so
 * nothing a duplicate uniquely carried is thrown away.
 */
function dedupeByPhone(rows: readonly ParsedContactRow[]): ParsedContactRow[] {
  const byPhone = new Map<string, ParsedContactRow>();

  for (const row of rows) {
    const key = row.phone.replace(/\D/g, '');
    const seen = byPhone.get(key);
    if (!seen) {
      byPhone.set(key, { ...row });
      continue;
    }
    for (const field of [
      'name',
      'name_tag',
      'email',
      'company',
      'tags',
      'areas_of_interest',
      'notes',
      'property_ref',
    ] as const) {
      if (!seen[field] && row[field]) seen[field] = row[field];
    }
    if (seen.min_budget === undefined && row.min_budget !== undefined) {
      seen.min_budget = row.min_budget;
    }
    if (seen.max_budget === undefined && row.max_budget !== undefined) {
      seen.max_budget = row.max_budget;
    }
  }

  return [...byPhone.values()];
}

// extract-preferences processes at most 25 contacts per request, so a
// larger import runs the extraction as sequential batches from here.
export const EXTRACT_BATCH_SIZE = 25;

export async function extractPreferencesInBatches(
  contactIds: string[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  onProgress?.(0, contactIds.length);
  for (let i = 0; i < contactIds.length; i += EXTRACT_BATCH_SIZE) {
    const batch = contactIds.slice(i, i + EXTRACT_BATCH_SIZE);
    try {
      await fetch('/api/contacts/extract-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: batch }),
      });
    } catch {
      // Best-effort: the share/match dialogs re-run extraction for any
      // contact they touch, so a failed batch heals itself later.
    }
    onProgress?.(
      Math.min(i + batch.length, contactIds.length),
      contactIds.length
    );
  }
}

/**
 * Rows per import request.
 *
 * The route writes each row with several sequential round trips — the
 * contact, its enquired-property link, a lookup and a link per tag, and
 * a note. A 500-row file is therefore a few thousand serial queries,
 * which is minutes of wall time in a single request and well past any
 * serverless limit. Splitting the upload keeps each request short and
 * gives the user progress instead of a spinner that eventually fails.
 *
 * Chunking is safe against duplicates because the route resolves
 * existing contacts by phone per request, so a number inserted by one
 * chunk is found and updated by the next rather than inserted twice.
 */
export const IMPORT_CHUNK_SIZE = 50;

export interface ImportTotals {
  imported: number;
  updated: number;
  failed: number;
  skipped: number;
  propertiesLinked: number;
  propertiesUnresolved: number;
  importedIds: string[];
  updatedIds: string[];
}

const EMPTY_TOTALS: ImportTotals = {
  imported: 0,
  updated: 0,
  failed: 0,
  skipped: 0,
  propertiesLinked: 0,
  propertiesUnresolved: 0,
  importedIds: [],
  updatedIds: [],
};

/**
 * POST the rows in chunks, accumulating the per-chunk report. Throws
 * only if the FIRST chunk fails — a later failure stops the run but
 * keeps what already landed, which is recoverable by re-uploading the
 * same file (existing numbers are then updated, not duplicated).
 */
export async function importContactsInChunks(
  rows: readonly ParsedContactRow[],
  onProgress?: (done: number, total: number) => void
): Promise<ImportTotals> {
  const totals: ImportTotals = {
    ...EMPTY_TOTALS,
    importedIds: [],
    updatedIds: [],
  };
  onProgress?.(0, rows.length);

  for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + IMPORT_CHUNK_SIZE);
    const res = await fetch('/api/contacts/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: chunk }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      if (i === 0) throw new Error(data?.error || 'Import failed');
      // Partial success: report what landed rather than discarding it.
      break;
    }

    totals.imported += data.imported ?? 0;
    totals.updated += data.updated ?? 0;
    totals.failed += data.failed ?? 0;
    totals.skipped += data.skipped ?? 0;
    totals.propertiesLinked += data.propertiesLinked ?? 0;
    totals.propertiesUnresolved += data.propertiesUnresolved ?? 0;
    if (Array.isArray(data.importedIds))
      totals.importedIds.push(...data.importedIds);
    if (Array.isArray(data.updatedIds))
      totals.updatedIds.push(...data.updatedIds);

    onProgress?.(Math.min(i + chunk.length, rows.length), rows.length);
  }

  return totals;
}
