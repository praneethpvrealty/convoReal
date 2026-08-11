// ============================================================
// Who reads what — the numbers behind a decision to translate.
//
// Two questions, deliberately answered side by side:
//
//   demand — how many contacts we would message in each language,
//            and how many agents read the app in it.
//   supply — how many approved template variants exist in it.
//
// Reported together because either alone is misleading. "400 contacts
// read Tamil" sounds like a win; "400 contacts read Tamil and every
// message to them goes out in English because no Tamil template is
// approved" is the actual state, and only the pair says so.
//
// Both aggregates run in SQL (migration 249) rather than pulling rows
// into the browser — an account with 50k contacts must not download
// them to learn that 400 read Tamil (AGENTS.md §2.6).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  LANGUAGE_CODES,
  toLanguageCode,
  type LanguageCode,
} from '@/lib/languages';

export interface LanguageUsageRow {
  language: LanguageCode;
  /** Agents reading the app in this language. */
  agents: number;
  /** Contacts we would message in it — preference, else account default. */
  contacts: number;
  /** Of those, how many chose it themselves. The gap is the assumption. */
  contactsExplicit: number;
  /** Approved template variants in this language. */
  approvedTemplates: number;
  /** Translated drafts nobody has signed off yet. */
  awaitingReview: number;
  /**
   * True when contacts would be messaged in this language and no
   * approved template exists for it — so every send to them silently
   * falls back to English. The one number worth acting on.
   */
  unservedDemand: boolean;
}

export interface LanguageUsageSummary {
  rows: LanguageUsageRow[];
  /** Languages in active use by contacts, beyond English. */
  activeLanguageCount: number;
  /** Contacts whose language has no approved template to serve it. */
  unservedContacts: number;
}

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Both aggregates, joined by language.
 *
 * A missing row on either side is zero rather than an error: the RPCs
 * return no rows for a non-member, and a caller asking about an
 * account they cannot see should read empty, not throw.
 */
export async function getLanguageUsage(
  db: SupabaseClient,
  accountId: string,
): Promise<LanguageUsageSummary> {
  const [usageRes, coverageRes] = await Promise.all([
    db.rpc('language_usage_stats', { p_account_id: accountId }),
    db.rpc('template_language_coverage', { p_account_id: accountId }),
  ]);

  if (usageRes.error) {
    console.error('[language-usage] usage rpc failed:', usageRes.error);
  }
  if (coverageRes.error) {
    console.error('[language-usage] coverage rpc failed:', coverageRes.error);
  }

  const usage = new Map<string, Record<string, unknown>>(
    ((usageRes.data ?? []) as Record<string, unknown>[]).map((r) => [
      String(r.language),
      r,
    ]),
  );
  const coverage = new Map<string, Record<string, unknown>>(
    ((coverageRes.data ?? []) as Record<string, unknown>[]).map((r) => [
      String(r.language),
      r,
    ]),
  );

  const rows: LanguageUsageRow[] = LANGUAGE_CODES.map((code) => {
    const u = usage.get(code);
    const c = coverage.get(code);
    const contacts = toNumber(u?.contacts);
    const approvedTemplates = toNumber(c?.approved_templates);
    return {
      language: toLanguageCode(code),
      agents: toNumber(u?.agents),
      contacts,
      contactsExplicit: toNumber(u?.contacts_explicit),
      approvedTemplates,
      awaitingReview: toNumber(c?.awaiting_review),
      // English is never "unserved": it IS the fallback, so a send to
      // an English contact with no template fails for a different
      // reason entirely and reporting it here would be noise.
      unservedDemand: code !== 'en' && contacts > 0 && approvedTemplates === 0,
    };
  });

  return {
    rows: [...rows].sort((a, b) => b.contacts - a.contacts),
    activeLanguageCount: rows.filter((r) => r.language !== 'en' && r.contacts > 0)
      .length,
    unservedContacts: rows
      .filter((r) => r.unservedDemand)
      .reduce((sum, r) => sum + r.contacts, 0),
  };
}
