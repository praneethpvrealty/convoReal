// @vitest-environment happy-dom

// ============================================================
// The locale provider, end to end: a consumer reads translated text,
// a switch re-renders it, and the declared language set is capped.
//
// These pin the wiring rather than the catalogue (that is covered by
// src/lib/i18n/messages.test.ts). The wiring is where the non-obvious
// constraints live: the first client render must match the server's
// English or React tears the tree down with a hydration mismatch,
// <html lang> has to follow the choice, and the set can never end up
// empty or holding a code the app cannot render.
// ============================================================

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

// No profile and no Supabase in these tests: the provider must work off
// its localStorage cache alone, which is exactly the cold-load path.
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ profile: null, refreshProfile: async () => {} }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    throw new Error('no network in unit tests');
  },
}));

const {
  LocaleProvider,
  useLocale,
  sanitizeLanguageSet,
  LOCALE_STORAGE_KEY,
  LOCALE_SET_STORAGE_KEY,
} = await import('./use-locale');

function Probe() {
  const { language, languages, setLanguage, setLanguages, t } = useLocale();
  return (
    <div>
      <span data-testid="label">{t('nav.dashboard')}</span>
      <span data-testid="lang">{language}</span>
      <span data-testid="set">{languages.join(',')}</span>
      <button onClick={() => setLanguage('kn')}>use-kn</button>
      <button onClick={() => setLanguages(['en', 'kn'])}>set-en-kn</button>
      <button onClick={() => setLanguages(['en', 'kn', 'ta'])}>set-three</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <LocaleProvider>
      <Probe />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
});

afterEach(cleanup);

describe('sanitizeLanguageSet', () => {
  it('caps at two', () => {
    expect(sanitizeLanguageSet(['en', 'kn', 'ta', 'hi'])).toEqual(['en', 'kn']);
  });

  it('drops unknown codes and duplicates', () => {
    expect(sanitizeLanguageSet(['kn', 'klingon', 'kn'])).toEqual(['kn']);
  });

  it('never returns empty', () => {
    expect(sanitizeLanguageSet([])).toEqual(['en']);
    expect(sanitizeLanguageSet(null)).toEqual(['en']);
    expect(sanitizeLanguageSet(['klingon'])).toEqual(['en']);
  });
});

describe('LocaleProvider', () => {
  it('renders English by default', () => {
    renderProbe();
    expect(screen.getByTestId('label').textContent).toBe('Dashboard');
    expect(screen.getByTestId('lang').textContent).toBe('en');
    expect(screen.getByTestId('set').textContent).toBe('en');
  });

  it('switches the rendered text and caches the choice', () => {
    renderProbe();
    fireEvent.click(screen.getByText('use-kn'));

    expect(screen.getByTestId('label').textContent).toBe('ಡ್ಯಾಶ್‌ಬೋರ್ಡ್');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('kn');
  });

  // Switching to a language that was never declared must adopt it,
  // not leave the agent reading something they did not choose with no
  // way back to it from the header.
  it('adopts an undeclared language into the set when switched to', () => {
    renderProbe();
    fireEvent.click(screen.getByText('use-kn'));
    expect(screen.getByTestId('set').textContent).toContain('kn');
  });

  it('stores a two-language set', () => {
    renderProbe();
    fireEvent.click(screen.getByText('set-en-kn'));
    expect(screen.getByTestId('set').textContent).toBe('en,kn');
    expect(localStorage.getItem(LOCALE_SET_STORAGE_KEY)).toBe('en,kn');
  });

  it('caps a three-language set at two', () => {
    renderProbe();
    fireEvent.click(screen.getByText('set-three'));
    expect(screen.getByTestId('set').textContent).toBe('en,kn');
  });

  it('restores a cached set and active language on mount', () => {
    localStorage.setItem(LOCALE_SET_STORAGE_KEY, 'en,ta');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'ta');
    renderProbe();
    expect(screen.getByTestId('set').textContent).toBe('en,ta');
    expect(screen.getByTestId('label').textContent).toBe('டாஷ்போர்டு');
  });

  // Anything could be in localStorage — an old code, a hand-edited
  // value, a key another app wrote. None of it may reach the UI.
  it('ignores a cached value that is not a supported code', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon');
    localStorage.setItem(LOCALE_SET_STORAGE_KEY, 'klingon,elvish');
    renderProbe();
    expect(screen.getByTestId('lang').textContent).toBe('en');
    expect(screen.getByTestId('set').textContent).toBe('en');
  });

  it('keeps <html lang> in step with the choice', () => {
    renderProbe();
    expect(document.documentElement.lang).toBe('en');

    fireEvent.click(screen.getByText('use-kn'));
    expect(document.documentElement.lang).toBe('kn');
  });

  it('gives a consumer outside the provider readable English, not a crash', () => {
    render(<Probe />);
    expect(screen.getByTestId('label').textContent).toBe('Dashboard');
    expect(screen.getByTestId('set').textContent).toBe('en');
  });
});
