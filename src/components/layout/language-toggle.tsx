"use client";

import { useLocale } from "@/hooks/use-locale";
import { SUPPORTED_LANGUAGES, type LanguageCode } from "@/lib/languages";
import { cn } from "@/lib/utils";

/**
 * Header switch between the languages an agent said they read.
 *
 * Renders nothing for a single-language agent — which is everyone by
 * default. A control that cannot do anything is worse than no control:
 * it takes header space on every screen and invites a click that does
 * nothing. Pick a second language in Settings and it appears.
 *
 * Shows the endonym in its own script ("ಕನ್ನಡ", not "Kannada"), because
 * the person reading it reads that script — that is why they chose it.
 */
export function LanguageToggle() {
  const { language, languages, setLanguage } = useLocale();

  if (languages.length < 2) return null;

  return (
    <div
      role="group"
      aria-label="Display language"
      className="hidden items-center gap-0.5 rounded-lg border border-slate-900 bg-slate-900/40 p-0.5 sm:flex"
    >
      {languages.map((code) => (
        <LanguagePill
          key={code}
          code={code}
          isActive={code === language}
          onPick={() => setLanguage(code)}
        />
      ))}
    </div>
  );
}

function LanguagePill({
  code,
  isActive,
  onPick,
}: {
  code: LanguageCode;
  isActive: boolean;
  onPick: () => void;
}) {
  const { label, native } = SUPPORTED_LANGUAGES[code];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isActive}
      // The endonym alone is ambiguous to a screen reader announcing in
      // another language, so the accessible name carries the English.
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-semibold transition-colors cursor-pointer",
        isActive
          ? "bg-primary/15 text-primary"
          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
      )}
    >
      {native}
    </button>
  );
}
