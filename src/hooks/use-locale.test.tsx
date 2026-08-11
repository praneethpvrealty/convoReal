// @vitest-environment happy-dom

// ============================================================
// The locale provider, end to end: a consumer reads translated text,
// a switch re-renders it, and the choice survives a remount.
//
// These pin the wiring rather than the catalogue (that is covered by
// src/lib/i18n/messages.test.ts). The wiring is where the two
// non-obvious constraints live: the first client render must match
// the server's English or React tears the tree down with a hydration
// mismatch, and <html lang> has to follow the choice or the page
// misdescribes itself to screen readers.
// ============================================================

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

import { LocaleProvider, useLocale, LOCALE_STORAGE_KEY } from './use-locale';

function Probe() {
  const { language, setLanguage, t } = useLocale();
  return (
    <div>
      <span data-testid="label">{t('nav.dashboard')}</span>
      <span data-testid="lang">{language}</span>
      <button onClick={() => setLanguage('kn')}>kn</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
});

afterEach(cleanup);

describe('LocaleProvider', () => {
  it('renders English by default', () => {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>
    );
    expect(screen.getByTestId('label').textContent).toBe('Dashboard');
    expect(screen.getByTestId('lang').textContent).toBe('en');
  });

  it('switches the rendered text and persists the choice', () => {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>
    );

    fireEvent.click(screen.getByText('kn'));

    expect(screen.getByTestId('label').textContent).toBe('ಡ್ಯಾಶ್‌ಬೋರ್ಡ್');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('kn');
  });

  it('restores a stored language on mount', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'ta');
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>
    );
    expect(screen.getByTestId('lang').textContent).toBe('ta');
    expect(screen.getByTestId('label').textContent).toBe('டாஷ்போர்டு');
  });

  // Anything could be in localStorage — an old code, a hand-edited
  // value, a key another app wrote. None of it may reach the UI.
  it('ignores a stored value that is not a supported code', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon');
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>
    );
    expect(screen.getByTestId('lang').textContent).toBe('en');
  });

  it('keeps <html lang> in step with the choice', () => {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>
    );
    expect(document.documentElement.lang).toBe('en');

    fireEvent.click(screen.getByText('kn'));
    expect(document.documentElement.lang).toBe('kn');
  });

  it('gives a consumer outside the provider readable English, not a crash', () => {
    render(<Probe />);
    expect(screen.getByTestId('label').textContent).toBe('Dashboard');
  });
});
