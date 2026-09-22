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
  toLanguageCode,
  type LanguageCode,
} from '@/lib/languages';

/** Meta codes that count as English when falling back. */
const ENGLISH_META_CODES = new Set(['en_US', 'en_GB', 'en']);

/**
 * When Marketing to this recipient is blocked, a deliverable template
 * in the wrong language beats an undeliverable one in the right one.
 *
 * Meta fixes a category per (name, language), and it downgrades a
 * Utility submission it reads as promotional — so one account can hold
 * `property_requirement_review` as Utility in English and Marketing in
 * Kannada. For a contact under a frequency cap (131049) or inside an
 * experiment group (130472), the Kannada variant is dropped and the
 * English one arrives. Language is a presentation choice; delivery is
 * not, so delivery wins for exactly as long as the pause stands.
 */
export interface LanguagePickOptions {
  /** True only while Marketing to this recipient is paused. */
  preferUtility?: boolean;
}

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
  accountDefault: string | null | undefined
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
export function pickTemplateForLanguage<T extends LanguageCandidate>(
  candidates: T[],
  language: LanguageCode,
  opts: LanguagePickOptions = {}
): T | null {
  if (candidates.length === 0) return null;

  const approved = candidates.filter((c) => isApproved(c));
  const wanted = metaLanguageCode(language);

  const inWanted = approved.find((c) => c.language === wanted);

  // Only when Marketing is paused, and only when the recipient's own
  // variant is the Marketing one: a Utility row in their language is
  // already the best answer and is found by the normal order below.
  if (opts.preferUtility && !isUtility(inWanted)) {
    const utility =
      approved.find((c) => c.language === wanted && isUtility(c)) ??
      approved.find(
        (c) => ENGLISH_META_CODES.has(c.language ?? '') && isUtility(c)
      ) ??
      approved.find((c) => isUtility(c));
    if (utility) return utility;
  }

  if (inWanted) return inWanted;

  const inEnglish = approved.find((c) =>
    ENGLISH_META_CODES.has(c.language ?? '')
  );
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
export function narrowToLanguage<T extends LanguageCandidate>(
  candidates: T[],
  language: LanguageCode,
  opts: LanguagePickOptions = {}
): T[] {
  const wanted = metaLanguageCode(language);
  const matches = candidates.filter(
    (c) => c.language === wanted && isApproved(c)
  );

  if (opts.preferUtility && !matches.some(isUtility)) {
    const utility = candidates.filter((c) => isApproved(c) && isUtility(c));
    if (utility.length > 0) return utility;
  }

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
  language: LanguageCode
): boolean {
  if (!chosen) return false;
  return (chosen.language ?? '') !== metaLanguageCode(language);
}

/**
 * The account's fallback language, on its own.
 *
 * For a batch job that loops over many recipients: read this once,
 * then combine with each contact's own preference via
 * resolveLanguage() instead of one round trip per recipient.
 */
export async function accountDefaultLanguage(
  db: SupabaseClient,
  accountId: string
): Promise<LanguageCode> {
  try {
    const { data } = await db
      .from('accounts')
      .select('default_language')
      .eq('id', accountId)
      .maybeSingle();
    return toLanguageCode(
      (data as { default_language?: string | null } | null)?.default_language
    );
  } catch (err) {
    console.error('[template-language] account default lookup failed:', err);
    return DEFAULT_LANGUAGE;
  }
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
  contactId: string | null
): Promise<LanguageCode> {
  try {
    const [contactRes, accountRes] = await Promise.all([
      contactId
        ? db
            .from('contacts')
            .select('preferred_language')
            .eq('id', contactId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      db
        .from('accounts')
        .select('default_language')
        .eq('id', accountId)
        .maybeSingle(),
    ]);
    return resolveLanguage(
      (contactRes.data as { preferred_language?: string | null } | null)
        ?.preferred_language,
      (accountRes.data as { default_language?: string | null } | null)
        ?.default_language
    );
  } catch (err) {
    console.error('[template-language] preference lookup failed:', err);
    return DEFAULT_LANGUAGE;
  }
}

/**
 * Load the right language variant of a template for one recipient.
 *
 * The shape every send path had already written by hand — query by
 * name, take a row, send it — with the language step folded in. Eight
 * call sites repeating the fetch-resolve-pick dance is eight chances
 * to forget the pick, and forgetting is invisible: the send succeeds,
 * in English.
 *
 * Returns the language that was WANTED alongside the row, so a caller
 * can tell that it fell back and say so. Rows of every status are
 * returned (see pickTemplateForLanguage) because callers distinguish
 * "pending Meta approval" from "never created" themselves.
 */
export async function loadTemplateForContact<T extends TemplateRow>(
  db: SupabaseClient,
  opts: {
    accountId: string;
    /** Null for a recipient with no contact row — account default then. */
    contactId?: string | null;
    /** Pass when the language is already known, to skip a round trip. */
    language?: LanguageCode;
    /** Candidate names, newest-first preference preserved. */
    names: readonly string[];
    /**
     * Override the Marketing-pause lookup. Pass false on a path that
     * cannot send Marketing anyway, or true when the caller already
     * knows; omit it and the contact's own state decides.
     */
    preferUtility?: boolean;
  }
): Promise<{ template: T | null; language: LanguageCode; fellBack: boolean }> {
  const [language, preferUtility] = await Promise.all([
    opts.language ??
      resolveSendLanguage(db, opts.accountId, opts.contactId ?? null),
    opts.preferUtility ??
      (opts.contactId
        ? isMarketingPaused(db, opts.accountId, opts.contactId)
        : false),
  ]);

  const { data } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', opts.accountId)
    .in('name', opts.names as string[])
    .order('last_submitted_at', { ascending: false, nullsFirst: false });

  const template = pickTemplateForLanguage((data ?? []) as T[], language, {
    preferUtility,
  });
  return {
    template,
    language,
    fellBack: isLanguageFallback(template, language),
  };
}

/** Minimum a row needs for the language pick to work. */
interface TemplateRow {
  language?: string | null;
  status?: string | null;
}

/** A row the pickers can rank: language, approval, and category. */
interface LanguageCandidate {
  language?: string | null;
  status?: string | null;
  category?: string | null;
}

/**
 * Is Marketing to this contact paused right now? Read by the loader so
 * every send path gets the Utility preference without asking for it.
 * Best-effort, like the language lookup: an unreadable row means no
 * pause, which is the behaviour every caller had before.
 */
export async function isMarketingPaused(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  now: Date = new Date()
): Promise<boolean> {
  try {
    const { data } = await db
      .from('contacts')
      .select('whatsapp_marketing_suppressed_until')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();
    const until = (
      data as { whatsapp_marketing_suppressed_until?: string | null } | null
    )?.whatsapp_marketing_suppressed_until;
    return Boolean(until && new Date(until).getTime() > now.getTime());
  } catch (err) {
    console.error('[template-language] marketing pause lookup failed:', err);
    return false;
  }
}

/**
 * One line, one shape, so a brokerage that set a language and never
 * approved a variant for it can find out from the logs instead of
 * wondering why every message still arrives in English.
 */
export function warnLanguageFallback(
  scope: string,
  accountId: string,
  language: LanguageCode,
  chosen: { language?: string | null } | null
): void {
  console.warn(
    `[${scope}] no approved ${language} variant for account ${accountId}; sent ${chosen?.language ?? 'none'}`
  );
}

function isUtility(row: { category?: string | null } | undefined): boolean {
  return (row?.category ?? '').toUpperCase() === 'UTILITY';
}

function isApproved(row: { status?: string | null }): boolean {
  // Status casing is not consistent across the codebase: migration 001
  // defines the CHECK as 'Approved', while the Meta sync path writes
  // 'APPROVED'. Both mean the same thing to a send.
  return (row.status ?? '').toUpperCase() === 'APPROVED';
}
