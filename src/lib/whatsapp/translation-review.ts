// ============================================================
// The gate between machine-written translated copy and Meta.
//
// The Indic bodies in template-copy.ts have not been reviewed by
// native speakers. They go out under a brokerage's own name, and a
// Meta rejection reserves the template name for four weeks
// (AGENTS.md §2.7), so an unreviewed submission is expensive in both
// directions — a bad approval reaches buyers, a bad rejection burns
// the name.
//
// So a non-English variant of an ENGINE template must be created as a
// local draft, read by someone who reads the language, and marked
// reviewed before it can be submitted.
//
// Three deliberate exemptions:
//
//   English      — the source copy, not a translation. Nothing to
//                  review, and gating it would break the existing
//                  one-tap flow for every account.
//
//   Account-authored templates — someone typed those words
//                  themselves. They are already the author and the
//                  reviewer; asking them to approve their own
//                  sentence is friction with no signal in it.
//
//   Edited copy  — handled in the database, not here: migration 248
//                  clears the sign-off whenever the body changes, so
//                  a reviewed template that is then reworded returns
//                  to unreviewed automatically.
// ============================================================

import { ENGINE_TEMPLATE_NAMES } from '@/lib/whatsapp/engine-templates';

const ENGLISH_META_CODES = new Set(['en_US', 'en_GB', 'en']);

export interface ReviewableRow {
  translation_reviewed_at?: string | null;
}

/**
 * Does this (name, language) pair need a sign-off before submission?
 */
export function requiresTranslationReview(
  templateName: string,
  metaLanguage: string,
): boolean {
  if (ENGLISH_META_CODES.has(metaLanguage)) return false;
  return ENGINE_TEMPLATE_NAMES.has(templateName);
}

/** Has this row been signed off? */
export function isTranslationReviewed(row: ReviewableRow | null): boolean {
  return Boolean(row?.translation_reviewed_at);
}

export const TRANSLATION_REVIEW_REQUIRED_MESSAGE =
  'This translation has not been reviewed yet. Open it, check the wording reads well to a native speaker, and mark it reviewed before submitting to Meta.';

export const TRANSLATION_REVIEW_MISSING_DRAFT_MESSAGE =
  'Create this translation as a draft first, review the wording, then submit it.';
