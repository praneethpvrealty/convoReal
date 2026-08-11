"use client";

import { Check } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { useLocale } from "@/hooks/use-locale";
import { THEMES, type ThemeId } from "@/lib/themes";
import {
  LANGUAGE_CODES,
  MAX_UI_LANGUAGES,
  SUPPORTED_LANGUAGES,
  languageDisplay,
  type LanguageCode,
} from "@/lib/languages";
import { cn } from "@/lib/utils";

/**
 * Appearance panel — color-theme picker.
 *
 * Click a card → applies + persists immediately. No save button:
 * the whole change is a single CSS-variable swap on <html>, there's
 * nothing to roll back. The active card carries a check chip + a
 * primary-tinted border so the current pick is obvious.
 *
 * Persistence: localStorage only (device-scoped). The boot script in
 * layout.tsx replays the choice before first paint on subsequent
 * loads.
 */
export function AppearancePanel() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="space-y-8">
      <LanguageSection />
      <ThemeSection theme={theme} setTheme={setTheme} />
    </div>
  );
}

/**
 * UI language. Separate from the account's default message language
 * on the Profile tab — this one changes what the agent reads, that
 * one changes what their clients receive. The help text says so,
 * because "language" appearing in two places is otherwise a trap.
 */
function LanguageSection() {
  const { language, languages, setLanguage, setLanguages, t } = useLocale();
  const atCap = languages.length >= MAX_UI_LANGUAGES;

  // Picking is additive up to the cap, then swaps. At the cap, clicking
  // a third language replaces the one you are NOT currently reading —
  // the alternative is an error toast telling you to go deselect
  // something first, which is a worse way to say the same thing.
  const toggle = (code: LanguageCode) => {
    if (languages.includes(code)) {
      // Never let the last one go: an agent with no language has no app.
      if (languages.length === 1) return;
      setLanguages(languages.filter((c) => c !== code));
      return;
    }
    if (!atCap) {
      setLanguages([...languages, code]);
      return;
    }
    setLanguages([language, code]);
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">
          {t("appearance.language")}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {t("appearance.languageHelp")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LANGUAGE_CODES.map((code) => {
          const chosen = languages.includes(code);
          const active = code === language;
          return (
            <button
              key={code}
              type="button"
              onClick={() => toggle(code)}
              aria-pressed={chosen}
              className={cn(
                "flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-all cursor-pointer",
                chosen
                  ? "border-primary/60 bg-primary/10"
                  : "border-slate-800 bg-slate-900/40 hover:border-slate-700",
              )}
            >
              <span className="min-w-0 truncate text-sm font-medium text-white">
                {languageDisplay(code)}
              </span>
              {chosen && (
                <span className="flex shrink-0 items-center gap-1.5">
                  {active && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                      {t("appearance.languageActive")}
                    </span>
                  )}
                  <Check className="size-4 text-primary" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {languages.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">
            {t("appearance.languageShowNow")}
          </span>
          {languages.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLanguage(code)}
              className={cn(
                "rounded-lg border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer",
                code === language
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700",
              )}
            >
              {SUPPORTED_LANGUAGES[code].native}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500">
        {t("appearance.languageCap")} {t("appearance.languageIncomplete")}
      </p>
    </section>
  );
}

function ThemeSection({
  theme,
  setTheme,
}: {
  theme: ThemeId;
  setTheme: (next: ThemeId) => void;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Color theme</h2>
        <p className="mt-1 text-sm text-slate-400">
          Pick the accent color used across the app. All themes stay
          dark — only the primary color (buttons, active nav, badges)
          changes. Saved to this device.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {THEMES.map((t) => (
          <ThemeCard
            key={t.id}
            id={t.id}
            name={t.name}
            tagline={t.tagline}
            swatch={t.swatch}
            isActive={t.id === theme}
            onPick={() => setTheme(t.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ThemeCard({
  id,
  name,
  tagline,
  swatch,
  isActive,
  onPick,
}: {
  id: ThemeId;
  name: string;
  tagline: string;
  swatch: string;
  isActive: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isActive}
      aria-label={`Use ${name} theme`}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-slate-800 hover:border-slate-700 hover:bg-slate-800/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          aria-hidden
          className="h-8 w-8 shrink-0 rounded-full"
          style={{
            background: swatch,
            boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.15)",
          }}
        />
        {isActive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
            <Check className="h-3 w-3" />
            Active
          </span>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold text-white">{name}</div>
        <div className="mt-1 text-xs leading-relaxed text-slate-400">
          {tagline}
        </div>
      </div>
      <div
        className="mt-1 flex h-2 overflow-hidden rounded-full"
        aria-hidden
      >
        <span className="flex-1" style={{ background: swatch }} />
        <span className="w-3 bg-slate-700" />
        <span className="w-3 bg-slate-800" />
        <span className="w-3 bg-slate-900" />
      </div>
      <span className="sr-only">Theme id: {id}</span>
    </button>
  );
}
