// ============================================================
// Has this account's copy fallen behind ours, or did they change it
// on purpose?
//
// Two facts about one row look identical from the outside: its body
// differs from the wording ConvoReal ships. That happens for opposite
// reasons —
//
//   the ACCOUNT edited it   → their wording, leave it alone
//   the SHIPPED copy moved  → ours improved, offer it to them
//
// and the right response is the opposite in each case. Without a way
// to tell them apart the only safe move is to do nothing, which means
// a correction from a native speaker lands in template-copy.ts and
// never reaches a single account that already created the template.
//
// So a row records the revision it was created from (migration 252).
// Two comparisons then separate all four states:
//
//   does the body still match what it started as?   → unedited
//   is the recorded revision the current one?       → shipped unchanged
//
// Nothing here writes. Adopting a newer revision is always a choice
// somebody makes — on an APPROVED template it re-opens Meta review
// and drops the account back to English until it clears, which is not
// a cost to impose on anyone silently.
// ============================================================

import {
  copyRevision,
  revisionOf,
  templateBody,
  templateFooter,
  type EngineTemplateKey,
} from '@/lib/whatsapp/template-copy';
import type { LanguageCode } from '@/lib/languages';

export type CopyDriftState =
  /** Body is the shipped wording, and the shipped wording is current. */
  | 'in_sync'
  /** The account reworded it. Theirs wins; never overwrite. */
  | 'customised'
  /** Untouched, but we ship better wording now. Safe to offer. */
  | 'update_available'
  /** Both moved. Show both and let a person decide. */
  | 'customised_and_outdated';

export interface DriftableRow {
  body_text: string;
  footer_text?: string | null;
  /** Revision this row was created from. Null on rows that predate
   *  migration 252 — see the note in resolveCopyDrift. */
  copy_revision?: string | null;
}

/**
 * The fingerprint a row's CURRENT content would have.
 *
 * Through revisionOf, the same function copyRevision uses. This
 * briefly had its own copy of the hash and the two disagreed on a
 * separator, so every row read as customised — the exact silent
 * mismatch this module exists to catch, produced by this module.
 */
function rowRevision(row: DriftableRow): string {
  return revisionOf(row.body_text, row.footer_text);
}

export function resolveCopyDrift(
  row: DriftableRow,
  key: EngineTemplateKey,
  language: LanguageCode,
): CopyDriftState {
  const shippedNow = copyRevision(key, language);
  const isShippedNow = rowRevision(row) === shippedNow;

  if (isShippedNow) return 'in_sync';

  // A row created before migration 252 has no recorded origin, so
  // "did they edit it?" is genuinely unanswerable. Resolve to
  // customised: that is the reading that never overwrites someone's
  // wording on a guess. It self-corrects the first time the row is
  // written, since every write path stamps the column.
  if (!row.copy_revision) return 'customised';

  const untouched = row.copy_revision === rowRevision(row);
  const shippedMoved = row.copy_revision !== shippedNow;

  if (untouched) {
    // Body still equals what it was created from, so any difference
    // from today's shipped copy is ours, not theirs.
    return shippedMoved ? 'update_available' : 'in_sync';
  }
  return shippedMoved ? 'customised_and_outdated' : 'customised';
}

/** True when there is newer shipped wording a person could take. */
export function hasCopyUpdate(state: CopyDriftState): boolean {
  return state === 'update_available' || state === 'customised_and_outdated';
}

/** The wording we would replace it with, for a diff or an adopt. */
export function shippedCopy(
  key: EngineTemplateKey,
  language: LanguageCode,
): { body_text: string; footer_text: string | null } {
  return {
    body_text: templateBody(key, language),
    footer_text: templateFooter(key, language) ?? null,
  };
}
