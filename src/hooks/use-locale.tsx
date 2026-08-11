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

import {
  DEFAULT_LANGUAGE,
  isLanguageCode,
  type LanguageCode,
} from '@/lib/languages';
import { translate, type MessageKey } from '@/lib/i18n/messages';

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
 * Device-scoped via localStorage, same reasoning as use-theme: it is
 * a per-device preference and needs no round trip to render.
 *
 * localStorage is read through useSyncExternalStore rather than an
 * effect. The server has no localStorage, so the value has to differ
 * between the server render and the client's first paint —
 * useSyncExternalStore is the API built for exactly that split
 * (getServerSnapshot vs getSnapshot) and hands us cross-tab sync in
 * the same subscription. Adopting the stored value from a mount
 * effect instead would set state during render-commit, which React
 * flags, and would also flash English for a frame.
 */

export const LOCALE_STORAGE_KEY = 'convoreal.locale';

interface LocaleContextValue {
  language: LanguageCode;
  setLanguage: (next: LanguageCode) => void;
  /** Translate a key, falling back to English when untranslated. */
  t: (key: MessageKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const listeners = new Set<() => void>();

/**
 * Read every call rather than caching. The snapshot is a string, so
 * React's Object.is check is by value and an unchanged read cannot
 * loop — and there is no cache left to go stale behind a write from
 * another tab.
 */
function getSnapshot(): LanguageCode {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLanguageCode(stored)) return stored;
  } catch {
    // localStorage throws in private-browsing / sandboxed contexts.
  }
  return DEFAULT_LANGUAGE;
}

/** No localStorage on the server — English, matching first paint. */
function getServerSnapshot(): LanguageCode {
  return DEFAULT_LANGUAGE;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    // Another tab changed the language; follow it without a refresh.
    if (e.key === LOCALE_STORAGE_KEY) onChange();
  };
  listeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function writeLanguage(next: LanguageCode): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // Nothing to persist to. Nothing else to do either: without a
    // store to read back from, this tab cannot hold the choice.
  }
  // `storage` does not fire in the tab that wrote it, so notify here.
  listeners.forEach((l) => l());
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  // Screen readers and the browser's own translation prompt both key
  // off this; leaving it at "en" while the page renders Tamil makes
  // the page actively misdescribe itself.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: LanguageCode) => {
    writeLanguage(next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key: MessageKey) => translate(language, key),
    }),
    [language, setLanguage]
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    // Rendered outside the provider — English, and a no-op setter, so
    // a stray component renders readable text instead of crashing.
    return {
      language: DEFAULT_LANGUAGE,
      setLanguage: () => {},
      t: (key: MessageKey) => translate(DEFAULT_LANGUAGE, key),
    };
  }
  return ctx;
}

/** Shorthand for the common case of needing only the translator. */
export function useT(): (key: MessageKey) => string {
  return useLocale().t;
}
