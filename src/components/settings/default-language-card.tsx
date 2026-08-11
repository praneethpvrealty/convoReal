'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES,
  languageDisplay,
  toLanguageCode,
  type LanguageCode,
} from '@/lib/languages';

/**
 * Account-wide outbound language, via PATCH /api/account. Sits next to
 * the business name because both answer "what does the client see?"
 * rather than "what do I see?" — the agent's own UI language is a
 * separate, per-user setting on the Appearance tab.
 */
export function DefaultLanguageCard() {
  const { account, canEditSettings, refreshProfile } = useAuth();

  const saved = toLanguageCode(account?.default_language);
  const [language, setLanguage] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (account) setLanguage(saved);
  }, [account, saved]);

  const dirty = !!account && language !== saved;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_language: language }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Request failed');
      }

      await refreshProfile();
      toast.success('Default language updated', {
        description: 'Contacts without their own language will use it.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update default language');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-slate-900/40 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white">Default message language</CardTitle>
        <CardDescription className="text-slate-400">
          The language outbound WhatsApp messages use when a contact has no
          language of their own. Set a contact&apos;s Preferred Language on their
          record to override this for them.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="default-language" className="text-slate-200">
              Default language
            </Label>
            <select
              id="default-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageCode)}
              disabled={saving || !account || !canEditSettings}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none disabled:opacity-50"
            >
              {LANGUAGE_CODES.map((code) => (
                <option key={code} value={code}>
                  {languageDisplay(code)}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">
              A message only goes out in this language if an approved template
              variant exists for it. Otherwise the send falls back to English.
            </p>
            {!canEditSettings && (
              <p className="text-xs text-slate-500">
                Only account admins can change the default language.
              </p>
            )}
          </div>

          {canEditSettings && (
            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save default language'
                )}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
