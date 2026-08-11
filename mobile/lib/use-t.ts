import { useCallback } from 'react';

import { useAuthStore } from './auth-store';
import { normalizeUiLanguage, translate, type UiMessageKey } from './i18n';

/**
 * The mobile counterpart of the web's useT() (src/hooks/use-locale.tsx).
 * The web header toggle persists the agent's choice to
 * profiles.active_ui_language (migration 247) precisely so the app can
 * read it here through the same RLS — an agent who picks Kannada on the
 * web finds the phone's helper in Kannada with no extra API surface.
 */
export function useT(): (key: UiMessageKey) => string {
  const language = useAuthStore((s) =>
    normalizeUiLanguage(s.profile?.active_ui_language)
  );
  return useCallback(
    (key: UiMessageKey) => translate(language, key),
    [language]
  );
}
