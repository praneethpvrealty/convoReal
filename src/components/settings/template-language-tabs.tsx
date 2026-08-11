'use client';

import { Clock } from 'lucide-react';

import {
  LANGUAGE_CODES,
  SUPPORTED_LANGUAGES,
  metaLanguageCode,
  type LanguageCode,
} from '@/lib/languages';
import type { MessageTemplate } from '@/types';
import { cn } from '@/lib/utils';

/**
 * One tab per language the product can send in, over the template
 * list.
 *
 * Meta keys a template on (name, language) and treats each pair as a
 * separate registration with its own approval — so "the property
 * details template" is really seven independent templates that happen
 * to share a name. A single flat list made that invisible: an account
 * with English and Kannada variants of five templates saw ten rows in
 * arbitrary order and no way to answer "what is missing in Kannada?"
 *
 * Each tab carries a count of how many Engine templates are live in
 * that language, which is the number that actually decides whether a
 * Kannada-speaking buyer hears from you in Kannada.
 */

export interface TemplateLanguageTabsProps {
  templates: MessageTemplate[];
  /** Total Engine templates, so a tab can read "3/7". */
  engineTemplateCount: number;
  engineTemplateNames: ReadonlySet<string>;
  active: LanguageCode;
  onChange: (next: LanguageCode) => void;
}

export function TemplateLanguageTabs({
  templates,
  engineTemplateCount,
  engineTemplateNames,
  active,
  onChange,
}: TemplateLanguageTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Template language"
      className="flex flex-wrap gap-1.5 rounded-xl border border-slate-800 bg-slate-900/40 p-1.5"
    >
      {LANGUAGE_CODES.map((code) => {
        const meta = metaLanguageCode(code);
        const inLanguage = templates.filter((t) => matchesLanguage(t, code));
        const approvedEngine = inLanguage.filter(
          (t) => engineTemplateNames.has(t.name) && isApproved(t),
        ).length;
        const awaitingReview = inLanguage.filter(
          (t) =>
            code !== 'en' &&
            engineTemplateNames.has(t.name) &&
            !t.translation_reviewed_at &&
            !isApproved(t),
        ).length;

        return (
          <button
            key={code}
            role="tab"
            type="button"
            aria-selected={code === active}
            onClick={() => onChange(code)}
            title={`${SUPPORTED_LANGUAGES[code].label} (${meta})`}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
              code === active
                ? 'bg-primary/15 text-primary'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
            )}
          >
            <span>{SUPPORTED_LANGUAGES[code].native}</span>
            <span
              className={cn(
                'rounded px-1 py-0.5 text-[10px] font-bold tabular-nums',
                approvedEngine === engineTemplateCount
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : approvedEngine > 0
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-slate-800 text-slate-500',
              )}
            >
              {approvedEngine}/{engineTemplateCount}
            </span>
            {awaitingReview > 0 && (
              <Clock
                className="size-3 text-amber-400"
                aria-label={`${awaitingReview} awaiting review`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Whether a stored row belongs to this tab.
 *
 * Not a plain equality check: Meta has three English codes (en_US,
 * en_GB, bare en) and a template synced from Meta or typed by hand can
 * carry any of them. Filing en_GB under "no language" would show the
 * English tab as empty for an account whose templates all work.
 */
function matchesLanguage(t: MessageTemplate, code: LanguageCode): boolean {
  const lang = t.language ?? 'en_US';
  if (code === 'en') return lang.toLowerCase().startsWith('en');
  return lang === metaLanguageCode(code);
}

function isApproved(t: MessageTemplate): boolean {
  return (t.status ?? '').toUpperCase() === 'APPROVED';
}

export { matchesLanguage as templateMatchesLanguage };
