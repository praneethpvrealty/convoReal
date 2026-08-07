// Client-side CSV contact import helpers, shared by the Contacts
// import dialog and the lead re-engage wizard. Parsing is pure; the
// extraction runner drives /api/contacts/extract-preferences from the
// browser because that endpoint caps contactIds at 25 per request.

import { suggestNameTagSplit } from '@/lib/contacts/name-tag-split';

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

export function parseContactsCsv(text: string): ParsedContactRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = headerLine
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/["']/g, ''));

  const phoneIdx = headers.indexOf('phone');
  if (phoneIdx === -1) return [];

  const nameIdx = headers.indexOf('name');
  const nameTagIdx =
    headers.indexOf('name_tag') >= 0
      ? headers.indexOf('name_tag')
      : headers.indexOf('name tag');
  const emailIdx = headers.indexOf('email');
  const companyIdx = headers.indexOf('company');
  const tagsIdx = headers.indexOf('tags');

  const areasIdx =
    headers.indexOf('areas of interest') >= 0
      ? headers.indexOf('areas of interest')
      : headers.indexOf('areas_of_interest');

  const minBudgetIdx =
    headers.indexOf('min budget') >= 0
      ? headers.indexOf('min budget')
      : headers.indexOf('min_budget');

  const maxBudgetIdx =
    headers.indexOf('max budget') >= 0
      ? headers.indexOf('max budget')
      : headers.indexOf('max_budget');

  const notesIdx =
    headers.indexOf('notes') >= 0
      ? headers.indexOf('notes')
      : headers.indexOf('preferences') >= 0
        ? headers.indexOf('preferences')
        : headers.indexOf('requirements');

  // The enquired property, under any of the header names a portal
  // export uses. First present column wins.
  const propertyRefIdx = [
    'property_id',
    'property id',
    'property_code',
    'property code',
    'portal_listing_id',
    'portal listing id',
    'listing_id',
    'listing id',
    'property',
  ]
    .map((h) => headers.indexOf(h))
    .find((i) => i >= 0);

  const rows: ParsedContactRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (handles quoted fields)
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

    const phone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!phone) continue;

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

  return rows;
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
