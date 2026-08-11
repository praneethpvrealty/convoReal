'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { languageDisplay } from '@/lib/languages';
import type { LanguageUsageSummary } from '@/lib/analytics/language-usage';
import { cn } from '@/lib/utils';

/**
 * Language usage: who reads what, against what we can actually send.
 *
 * Demand and supply in one table on purpose. "400 contacts read Tamil"
 * reads as a success; "400 contacts read Tamil and every message to
 * them goes out in English because no Tamil template is approved" is
 * the real state, and only the pair shows it. The unserved row is the
 * one that should make somebody do something.
 */
export function LanguageUsageCard() {
  const { account } = useAuth();
  const [data, setData] = useState<LanguageUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!account?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/analytics/language-usage');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (!cancelled) setData(body.data as LanguageUsageSummary);
      } catch (err) {
        console.error('[language-usage-card] load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account?.id]);

  return (
    <Card className="border-slate-800 bg-slate-900/40">
      <CardHeader>
        <CardTitle className="text-white">Language usage</CardTitle>
        <CardDescription className="text-slate-400">
          How many of your people read each language, and whether you hold an
          approved WhatsApp template to reach them in it.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !data ? (
          <p className="py-4 text-sm text-slate-500">
            Couldn&apos;t load language usage.
          </p>
        ) : (
          <div className="space-y-4">
            {data.unservedContacts > 0 && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs leading-relaxed text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {data.unservedContacts.toLocaleString('en-IN')} contact
                  {data.unservedContacts === 1 ? '' : 's'} would be messaged in a
                  language you have no approved template for. Those sends fall
                  back to English.
                </span>
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                    <th className="pb-2 font-medium">Language</th>
                    <th className="pb-2 text-right font-medium">Contacts</th>
                    <th className="pb-2 text-right font-medium">Chose it</th>
                    <th className="pb-2 text-right font-medium">Agents</th>
                    <th className="pb-2 text-right font-medium">Templates</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr
                      key={row.language}
                      className="border-b border-slate-900/60 last:border-0"
                    >
                      <td className="py-2 text-white">
                        {languageDisplay(row.language)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-300">
                        {row.contacts.toLocaleString('en-IN')}
                      </td>
                      {/* The gap between this and Contacts is how many
                          are inheriting the account default rather than
                          having said anything — i.e. how big the
                          assumption is. */}
                      <td className="py-2 text-right tabular-nums text-slate-500">
                        {row.contactsExplicit.toLocaleString('en-IN')}
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-300">
                        {row.agents.toLocaleString('en-IN')}
                      </td>
                      <td
                        className={cn(
                          'py-2 text-right tabular-nums',
                          row.unservedDemand
                            ? 'font-semibold text-amber-400'
                            : 'text-slate-300',
                        )}
                      >
                        {row.approvedTemplates}
                        {row.awaitingReview > 0 && (
                          <span className="ml-1 text-[10px] text-amber-400/80">
                            +{row.awaitingReview} to review
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-500">
              &ldquo;Contacts&rdquo; counts who each message would go to in that
              language — a contact with no preference of their own inherits your
              account default. &ldquo;Chose it&rdquo; is how many said so
              themselves.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
