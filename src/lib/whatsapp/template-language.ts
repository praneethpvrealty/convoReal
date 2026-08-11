// ============================================================
// Which language variant of a template a send should use.
//
// Meta keys a template on (name, language) and treats each pair as
// a separate registration with its own approval and its own
// category. There is no "translate at send time" — a Kannada
// message exists only if a Kannada template was submitted and
// approved under the same name.
//
// So resolution is a two-step lookup, not a translation:
//   1. what language does this recipient read?      (resolveLanguage)
//   2. do we hold an approved row in it?            (pickTemplateForLanguage)
//
// Step 2 falls back to English rather than failing. A message that
// goes out in English is worth strictly more than one that does not
// go out at all, and an account that has approved no variants — the
// state every account is in today — must keep sending exactly as it
// did before this module existed.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DEFAULT_LANGUAGE,
  isLanguageCode,
  metaLanguageCode,
  type LanguageCode,
} from '@/lib/languages';

/** Meta codes that count as English when falling back. */
const ENGLISH_META_CODES = new Set(['en_US', 'en_GB', 'en']);

/**
 * The language a message to this contact should go out in.
 *
 * Contact preference wins over the account default, and a contact
 * with no preference is NOT assumed to read English — they inherit
 * whatever the brokerage writes in. That is the whole point of the
 * account-level setting: a Chennai brokerage sets Tamil once and
 * every contact it has never asked follows.
 */
export function resolveLanguage(
  contactPreferred: string | null | undefined,
  accountDefault: string | null | undefined,
): LanguageCode {
  if (isLanguageCode(contactPreferred)) return contactPreferred;
  if (isLanguageCode(accountDefault)) return accountDefault;
  return DEFAULT_LANGUAGE;
}

/**
 * Pick the row to send from candidates sharing a template name.
 *
 * Preference order:
 *   1. an approved row in the wanted language
 *   2. an approved row in English
 *   3. the first candidate, whatever it is
 *
 * (3) exists because several callers pass rows of every status on
 * purpose — they need "submitted but pending" to stay
 * distinguishable from "never created", and decide what to do about
 * a non-approved row themselves. Dropping those here would turn a
 * pending template into a missing one and change their behaviour.
 *
 * Order within a status band is the caller's: these functions never
 * re-sort, so a caller that ordered by `last_submitted_at desc`
 * still gets its newest row.
 */
export function pickTemplateForLanguage<
  T extends { language?: string | null; status?: string | null },
>(candidates: T[], language: LanguageCode): T | null {
  if (candidates.length === 0) return null;

  const approved = candidates.filter((c) => isApproved(c));
  const wanted = metaLanguageCode(language);

  const inWanted = approved.find((c) => c.language === wanted);
  if (inWanted) return inWanted;

  const inEnglish = approved.find((c) => ENGLISH_META_CODES.has(c.language ?? ''));
  if (inEnglish) return inEnglish;

  return candidates[0] ?? null;
}

/**
 * Narrow candidates to the recipient's language, for callers that
 * already have their own picker (photo-vs-text, Utility-over-
 * Marketing) and need language applied without losing it.
 *
 * Returns the untouched list when nothing approved matches, so a
 * caller's existing policy runs over exactly the rows it always saw.
 * That is what makes this safe to add to a live send path: an
 * account holding only English templates cannot observe it.
 */
export function narrowToLanguage<
  T extends { language?: string | null; status?: string | null },
>(candidates: T[], language: LanguageCode): T[] {
  const wanted = metaLanguageCode(language);
  const matches = candidates.filter((c) => c.language === wanted && isApproved(c));
  return matches.length > 0 ? matches : candidates;
}

/**
 * True when the chosen row is not in the language that was asked
 * for. Callers log this — a brokerage that set Telugu and keeps
 * getting English sends has a missing template, and that is
 * invisible unless someone says so.
 */
export function isLanguageFallback(
  chosen: { language?: string | null } | null,
  language: LanguageCode,
): boolean {
  if (!chosen) return false;
  return (chosen.language ?? '') !== metaLanguageCode(language);
}

/**
 * The language for a send, read from the database.
 *
 * Best-effort by design: a failed lookup returns English rather than
 * throwing. Language is a presentation choice, and no send should be
 * lost because the preference behind it could not be read.
 */
export async function resolveSendLanguage(
  db: SupabaseClient,
  accountId: string,
  contactId: string | null,
): Promise<LanguageCode> {
  try {
    const [contactRes, accountRes] = await Promise.all([
      contactId
        ? db.from('contacts').select('preferred_language').eq('id', contactId).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from('accounts').select('default_language').eq('id', accountId).maybeSingle(),
    ]);
    return resolveLanguage(
      (contactRes.data as { preferred_language?: string | null } | null)?.preferred_language,
      (accountRes.data as { default_language?: string | null } | null)?.default_language,
    );
  } catch (err) {
    console.error('[template-language] preference lookup failed:', err);
    return DEFAULT_LANGUAGE;
  }
}

function isApproved(row: { status?: string | null }): boolean {
  // Status casing is not consistent across the codebase: migration 001
  // defines the CHECK as 'Approved', while the Meta sync path writes
  // 'APPROVED'. Both mean the same thing to a send.
  return (row.status ?? '').toUpperCase() === 'APPROVED';
}
