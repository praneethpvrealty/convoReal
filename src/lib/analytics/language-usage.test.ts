import { describe, it, expect, vi } from 'vitest';

import { getLanguageUsage } from './language-usage';
import { LANGUAGE_CODES } from '@/lib/languages';

type Row = Record<string, unknown>;

/** Minimal Supabase stub: two RPCs, keyed by name. */
function dbWith(usage: Row[], coverage: Row[], errors = false) {
  return {
    rpc: vi.fn(async (fn: string) => {
      if (errors) return { data: null, error: { message: 'boom' } };
      return {
        data: fn === 'language_usage_stats' ? usage : coverage,
        error: null,
      };
    }),
  } as never;
}

describe('getLanguageUsage', () => {
  it('returns a row per supported language even with no data', async () => {
    const out = await getLanguageUsage(dbWith([], []), 'a1');
    expect(out.rows).toHaveLength(LANGUAGE_CODES.length);
    expect(out.rows.every((r) => r.contacts === 0)).toBe(true);
  });

  it('joins demand and supply by language', async () => {
    const out = await getLanguageUsage(
      dbWith(
        [{ language: 'ta', agents: 2, contacts: 400, contacts_explicit: 120 }],
        [{ language: 'ta', approved_templates: 3, awaiting_review: 1 }],
      ),
      'a1',
    );
    const ta = out.rows.find((r) => r.language === 'ta')!;
    expect(ta).toMatchObject({
      agents: 2,
      contacts: 400,
      contactsExplicit: 120,
      approvedTemplates: 3,
      awaitingReview: 1,
    });
  });

  // The number worth acting on: people we would message in a language
  // we cannot actually send, so every message to them silently
  // degrades to English.
  it('flags demand with no approved template to serve it', async () => {
    const out = await getLanguageUsage(
      dbWith(
        [
          { language: 'ta', agents: 0, contacts: 400, contacts_explicit: 400 },
          { language: 'kn', agents: 0, contacts: 50, contacts_explicit: 50 },
        ],
        [{ language: 'kn', approved_templates: 2, awaiting_review: 0 }],
      ),
      'a1',
    );
    expect(out.rows.find((r) => r.language === 'ta')!.unservedDemand).toBe(true);
    expect(out.rows.find((r) => r.language === 'kn')!.unservedDemand).toBe(false);
    expect(out.unservedContacts).toBe(400);
  });

  // English IS the fallback, so it can never be "unserved" in the sense
  // that matters — reporting it would be permanent noise on every
  // account that has not made a template yet.
  it('never flags English as unserved', async () => {
    const out = await getLanguageUsage(
      dbWith([{ language: 'en', agents: 3, contacts: 900, contacts_explicit: 0 }], []),
      'a1',
    );
    expect(out.rows.find((r) => r.language === 'en')!.unservedDemand).toBe(false);
    expect(out.unservedContacts).toBe(0);
  });

  it('counts active non-English languages', async () => {
    const out = await getLanguageUsage(
      dbWith(
        [
          { language: 'en', agents: 1, contacts: 900, contacts_explicit: 0 },
          { language: 'ta', agents: 0, contacts: 400, contacts_explicit: 400 },
          { language: 'hi', agents: 0, contacts: 12, contacts_explicit: 12 },
          { language: 'kn', agents: 0, contacts: 0, contacts_explicit: 0 },
        ],
        [],
      ),
      'a1',
    );
    expect(out.activeLanguageCount).toBe(2);
  });

  it('sorts by contact count, biggest first', async () => {
    const out = await getLanguageUsage(
      dbWith(
        [
          { language: 'hi', agents: 0, contacts: 12, contacts_explicit: 12 },
          { language: 'ta', agents: 0, contacts: 400, contacts_explicit: 400 },
        ],
        [],
      ),
      'a1',
    );
    expect(out.rows[0].language).toBe('ta');
  });

  // Postgres returns bigint as a string over PostgREST; a raw value
  // would make every count concatenate instead of add.
  it('coerces bigint-as-string counts to numbers', async () => {
    const out = await getLanguageUsage(
      dbWith(
        [{ language: 'ta', agents: '2', contacts: '400', contacts_explicit: '5' }],
        [{ language: 'ta', approved_templates: '1', awaiting_review: '0' }],
      ),
      'a1',
    );
    const ta = out.rows.find((r) => r.language === 'ta')!;
    expect(ta.contacts).toBe(400);
    expect(ta.agents).toBe(2);
    expect(ta.approvedTemplates).toBe(1);
  });

  // A non-member gets no rows from the RPCs; that must read as an
  // empty account, not crash the page that asked.
  it('reads as zeros when the rpcs fail', async () => {
    const out = await getLanguageUsage(dbWith([], [], true), 'a1');
    expect(out.rows).toHaveLength(LANGUAGE_CODES.length);
    expect(out.unservedContacts).toBe(0);
  });
});
