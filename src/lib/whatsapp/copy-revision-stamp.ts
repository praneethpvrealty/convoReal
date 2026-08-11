// ============================================================
// The stamp a write path puts on message_templates.copy_revision.
//
// Its own module because the two ends it joins live apart and should
// stay that way: template-copy.ts knows the wording and nothing about
// Meta, engine-templates.ts knows the names, and the route layer
// speaks in Meta's language codes. This is the one place that
// translates between them, so a route writes one field and cannot get
// the mapping subtly wrong on its own.
//
// See migration 252 for what the column is for.
// ============================================================

import { languageForMetaCode } from '@/lib/languages';
import { engineCopyKey } from '@/lib/whatsapp/engine-templates';
import { copyRevision, revisionOf } from '@/lib/whatsapp/template-copy';

/**
 * The revision to record for a row about to be written, or null when
 * there is nothing meaningful to record.
 *
 * Null means the row did not come from copy we ship, so no later
 * improvement of ours exists for it to fall behind — either the name
 * is not an engine template (the account wrote it) or the language is
 * one the product does not speak.
 *
 * The column answers "which of OUR revisions is this row's origin",
 * which is not the same as "what is our current revision", and writing
 * the latter is the easy mistake. Consider a row created from shipped
 * revision X, never edited, that the account re-submits after we have
 * moved to Y: stamping Y makes the body no longer match its own stamp,
 * and the row reads as the account's own wording. Their untouched row
 * would stop being offered the improvement it was owed.
 *
 * So three cases:
 *
 *   content IS today's shipped copy  → today's revision
 *   content diverges, origin known   → keep the origin already recorded
 *   content diverges, no origin      → today's, the only defensible
 *                                      guess for a first write
 *
 * A pair we hold no translation for is not special-cased: it stamps
 * the English fallback it was genuinely built from, and that is the
 * case the column earns its keep on. When the Kannada wording lands
 * later the stamp still matches the row's body, so it reads as
 * untouched with an update waiting rather than as somebody's own words.
 *
 * Takes Meta's code (`en_US`, `kn`) rather than a LanguageCode because
 * that is what the payload and the column both carry.
 */
export function stampFor(
  name: string,
  metaLanguage: string,
  content: { body_text: string; footer_text?: string | null },
  previous?: string | null,
): string | null {
  const key = engineCopyKey(name);
  if (!key) return null;

  const language = languageForMetaCode(metaLanguage);
  if (!language) return null;

  const shipped = copyRevision(key, language);
  if (revisionOf(content.body_text, content.footer_text) === shipped) {
    return shipped;
  }
  return previous ?? shipped;
}
