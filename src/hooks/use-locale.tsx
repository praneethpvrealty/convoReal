'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  DEFAULT_LANGUAGE,
  MAX_UI_LANGUAGES,
  isLanguageCode,
  type LanguageCode,
} from '@/lib/languages';
import { translate, type MessageKey } from '@/lib/i18n/messages';
import { readStored, writeStored } from '@/lib/safe-storage';

/**
 * LocaleProvider — the agent's own UI language.
 *
 * Deliberately NOT the same setting as accounts.default_language or
 * contacts.preferred_language. Those decide what a CLIENT reads in a
 * WhatsApp message; this decides what the person using the app reads
 * on screen. A Bangalore agent can run the app in Kannada while
 * messaging a Hindi-speaking buyer in Hindi, and conflating the two
 * would make one of those impossible.
 *
 * An agent declares the languages they read (`languages`, capped at
 * MAX_UI_LANGUAGES) and one of them is active. Two stores, on purpose:
 *
 *   profiles.ui_languages / .active_ui_language — the truth. On the
 *     profile rather than the account because it is personal, and
 *     because the mobile app already reads profiles through the same
 *     RLS, so the phone picks the choice up with no new API.
 *
 *   localStorage — a first-paint cache. The profile arrives one round
 *     trip after mount; without the cache every load would render
 *     English and then repaint, which on a slow connection is the
 *     whole sidebar visibly changing language.
 *
 * Reads go through useSyncExternalStore rather than an effect: the
 * server has no localStorage, so the value must differ between the
 * server render and the client's first paint, which is exactly the
 * split getServerSnapshot/getSnapshot exists for. It also hands us
 * cross-tab sync in the same subscription.
 */

export const LOCALE_STORAGE_KEY = 'convoreal.locale';
export const LOCALE_SET_STORAGE_KEY = 'convoreal.locale.set';

interface LocaleContextValue {
  /** The language the app is rendering in. */
  language: LanguageCode;
  /** Every language this agent declared they read. Always includes
   *  `language`, always at least one entry. */
  languages: LanguageCode[];
  /** Switch the active language. Must be one of `languages`. */
  setLanguage: (next: LanguageCode) => void;
  /** Replace the declared set. Trimmed to MAX_UI_LANGUAGES; the active
   *  language follows if it is no longer in the set. */
  setLanguages: (next: LanguageCode[]) => void;
  /** Translate a key, falling back to English when untranslated. */
  t: (key: MessageKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const listeners = new Set<() => void>();

/** Narrow, de-duplicate and cap an untrusted list of codes. */
export function sanitizeLanguageSet(input: unknown): LanguageCode[] {
  const list = Array.isArray(input) ? input : [];
  const seen: LanguageCode[] = [];
  for (const item of list) {
    if (isLanguageCode(item) && !seen.includes(item)) seen.push(item);
    if (seen.length === MAX_UI_LANGUAGES) break;
  }
  // Never empty: an agent with no language has no app.
  return seen.length > 0 ? seen : [DEFAULT_LANGUAGE];
}

/**
 * Read every call rather than caching. Snapshots are compared with
 * Object.is, so the active language (a string) is safe; the SET is
 * returned as a joined string for the same reason — a fresh array
 * every read would never compare equal and would loop forever.
 */
function getActiveSnapshot(): LanguageCode {
  try {
    const stored = readStored(LOCALE_STORAGE_KEY);
    if (isLanguageCode(stored)) return stored;
  } catch {
    // localStorage throws in private-browsing / sandboxed contexts.
  }
  return DEFAULT_LANGUAGE;
}

function getSetSnapshot(): string {
  try {
    const stored = readStored(LOCALE_SET_STORAGE_KEY);
    if (stored) return sanitizeLanguageSet(stored.split(',')).join(',');
  } catch {
    // See above.
  }
  return DEFAULT_LANGUAGE;
}

function getServerActiveSnapshot(): LanguageCode {
  return DEFAULT_LANGUAGE;
}

function getServerSetSnapshot(): string {
  return DEFAULT_LANGUAGE;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    // Another tab changed the language; follow it without a refresh.
    if (e.key === LOCALE_STORAGE_KEY || e.key === LOCALE_SET_STORAGE_KEY) {
      onChange();
    }
  };
  listeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function writeCache(active: LanguageCode, set: LanguageCode[]): void {
  try {
    writeStored(LOCALE_STORAGE_KEY, active);
    writeStored(LOCALE_SET_STORAGE_KEY, set.join(','));
  } catch {
    // Nothing to cache to; the profile is still the truth and the
    // in-memory notify below still repaints this tab.
  }
  // `storage` does not fire in the tab that wrote it, so notify here.
  listeners.forEach((l) => l());
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { profile, refreshProfile } = useAuth();

  const language = useSyncExternalStore(
    subscribe,
    getActiveSnapshot,
    getServerActiveSnapshot
  );
  const languageSetKey = useSyncExternalStore(
    subscribe,
    getSetSnapshot,
    getServerSetSnapshot
  );
  const languages = useMemo(
    () => sanitizeLanguageSet(languageSetKey.split(',')),
    [languageSetKey]
  );

  // The profile is the truth; the cache is only ahead of it during the
  // first paint of a cold load. Once the row lands, reconcile.
  const profileLanguages = profile?.ui_languages;
  const profileActive = profile?.active_ui_language;
  useEffect(() => {
    if (!profile) return;
    const set = sanitizeLanguageSet(profileLanguages);
    const active =
      isLanguageCode(profileActive) && set.includes(profileActive)
        ? profileActive
        : set[0];
    if (active !== getActiveSnapshot() || set.join(',') !== getSetSnapshot()) {
      writeCache(active, set);
    }
  }, [profile, profileLanguages, profileActive]);

  // Screen readers and the browser's own translation prompt both key
  // off this; leaving it at "en" while the page renders Tamil makes
  // the page actively misdescribe itself.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const profileId = profile?.id;

  // Cache first so the UI flips instantly, then persist. A failed write
  // leaves the tab correct and the next load reverts — better than
  // blocking the toggle on a round trip.
  const persist = useCallback(
    async (active: LanguageCode, set: LanguageCode[]) => {
      writeCache(active, set);
      if (!profileId) return;
      const supabase = createClient();
      // .select() is not decoration: an RLS refusal comes back as zero
      // rows with no error, so without it a refused write would look
      // like a save and the choice would silently revert on reload.
      const { data, error } = await supabase
        .from('profiles')
        .update({ ui_languages: set, active_ui_language: active })
        .eq('id', profileId)
        .select('id');
      if (error || !data || data.length === 0) {
        console.error(
          '[locale] failed to persist language choice:',
          error ?? 'no rows updated (RLS?)'
        );
        return;
      }
      await refreshProfile();
    },
    [profileId, refreshProfile]
  );

  const setLanguage = useCallback(
    (next: LanguageCode) => {
      // Switching to a language the agent never declared would strand
      // them in something they cannot read, so adopt it into the set.
      const set = languages.includes(next)
        ? languages
        : sanitizeLanguageSet([next, ...languages]);
      void persist(next, set);
    },
    [languages, persist]
  );

  const setLanguages = useCallback(
    (next: LanguageCode[]) => {
      const set = sanitizeLanguageSet(next);
      const active = set.includes(language) ? language : set[0];
      void persist(active, set);
    },
    [language, persist]
  );

  const value = useMemo<LocaleContextValue>(
    () => ({
      language,
      languages,
      setLanguage,
      setLanguages,
      t: (key: MessageKey) => translate(language, key),
    }),
    [language, languages, setLanguage, setLanguages]
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    // Rendered outside the provider — English, and no-op setters, so
    // a stray component renders readable text instead of crashing.
    return {
      language: DEFAULT_LANGUAGE,
      languages: [DEFAULT_LANGUAGE],
      setLanguage: () => {},
      setLanguages: () => {},
      t: (key: MessageKey) => translate(DEFAULT_LANGUAGE, key),
    };
  }
  return ctx;
}

/** Shorthand for the common case of needing only the translator. */
export function useT(): (key: MessageKey) => string {
  return useLocale().t;
}
