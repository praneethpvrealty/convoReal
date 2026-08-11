// ============================================================
// Service-role view of the account under test.
//
// Two jobs: reset state between cases, and compute what the UI OUGHT
// to show independently of the code that shows it. The analytics
// assertions re-derive their expected numbers here rather than
// hardcoding them, so the suite keeps working as the account's data
// moves and still fails if the aggregate itself drifts.
// ============================================================

import { createClient } from '@supabase/supabase-js';

const URL = process.env.E2E_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;

export const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let cached = null;

/** The profile + account behind E2E_EMAIL. */
export async function context() {
  if (cached) return cached;
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const user = users.users.find(
    (u) => u.email?.toLowerCase() === process.env.E2E_EMAIL.toLowerCase(),
  );
  if (!user) throw new Error('E2E_EMAIL has no auth user');
  const { data: profile } = await db
    .from('profiles')
    .select('id, account_id')
    .eq('user_id', user.id)
    .single();
  const { data: account } = await db
    .from('accounts')
    .select('id, default_language')
    .eq('id', profile.account_id)
    .single();
  cached = { userId: user.id, profileId: profile.id, accountId: account.id, account };
  return cached;
}

export async function readLocale() {
  const { profileId } = await context();
  const { data } = await db
    .from('profiles')
    .select('ui_languages, active_ui_language')
    .eq('id', profileId)
    .single();
  return data;
}

export async function resetLocale() {
  const { profileId } = await context();
  await db
    .from('profiles')
    .update({ ui_languages: ['en'], active_ui_language: 'en' })
    .eq('id', profileId);
}

const META_CODES = {
  en: ['en_US', 'en_GB', 'en'],
  hi: ['hi'], kn: ['kn'], ta: ['ta'], te: ['te'], ml: ['ml'], mr: ['mr'],
};

/**
 * The per-language numbers, derived from base tables.
 *
 * Deliberately NOT by calling language_usage_stats(): comparing that
 * function against itself proves nothing. This recomputes the same
 * question from contacts / profiles / message_templates so a
 * disagreement points at the aggregate.
 */
export async function expectedLanguageUsage() {
  const { accountId, account } = await context();
  const fallback = account.default_language ?? 'en';

  const { data: contacts } = await db
    .from('contacts')
    .select('preferred_language, is_merged, chain_only')
    .eq('account_id', accountId);
  const { data: profiles } = await db
    .from('profiles')
    .select('active_ui_language')
    .eq('account_id', accountId);
  const { data: templates } = await db
    .from('message_templates')
    .select('language, status, translation_reviewed_at')
    .eq('account_id', accountId);

  const rows = {};
  for (const code of Object.keys(META_CODES)) {
    const inLang = (templates ?? []).filter((t) => META_CODES[code].includes(t.language));
    rows[code] = {
      agents: (profiles ?? []).filter((p) => (p.active_ui_language ?? 'en') === code).length,
      contacts: (contacts ?? []).filter(
        (c) =>
          c.is_merged === false &&
          (c.chain_only ?? false) === false &&
          (c.preferred_language ?? fallback) === code,
      ).length,
      contactsExplicit: (contacts ?? []).filter(
        (c) =>
          c.is_merged === false &&
          (c.chain_only ?? false) === false &&
          c.preferred_language === code,
      ).length,
      approvedTemplates: inLang.filter((t) => (t.status ?? '').toUpperCase() === 'APPROVED').length,
      // Counted over rows that exist. A language with no templates has
      // nothing awaiting review.
      awaitingReview: inLang.filter(
        (t) => (t.status ?? '').toUpperCase() !== 'APPROVED' && t.translation_reviewed_at === null,
      ).length,
    };
  }
  return rows;
}

export async function templatesInLanguage(metaCode) {
  const { accountId } = await context();
  const { data } = await db
    .from('message_templates')
    .select('id, name, language, status, translation_reviewed_at, body_text, meta_template_id')
    .eq('account_id', accountId)
    .eq('language', metaCode);
  return data ?? [];
}

export async function deleteTemplates(ids) {
  if (ids.length) await db.from('message_templates').delete().in('id', ids);
}

export async function templateCount() {
  const { accountId } = await context();
  const { count } = await db
    .from('message_templates')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  return count;
}
