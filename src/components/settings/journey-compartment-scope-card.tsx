'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  journeyCompartmentScopeOf,
  type JourneyCompartmentScope,
} from '@/lib/journey/compartments';

const OPTIONS: {
  value: JourneyCompartmentScope;
  label: string;
  description: string;
}[] = [
  {
    value: 'team',
    label: 'Shared with the team',
    description:
      'One Focus list for the account. Moving a journey moves it for everyone.',
  },
  {
    value: 'agent',
    label: 'Each agent keeps their own',
    description:
      'Every agent curates their own Focus list. Nobody else’s moves change it.',
  },
];

export function JourneyCompartmentScopeCard() {
  const { account, canEditSettings, refreshProfile } = useAuth();

  const saved = journeyCompartmentScopeOf(account?.journey_compartment_scope);
  const [scope, setScope] = useState<JourneyCompartmentScope>(saved);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (account) setScope(saved);
  }, [account, saved]);

  const dirty = !!account && scope !== saved;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ journey_compartment_scope: scope }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Request failed');
      }
      await refreshProfile();
      toast.success('Focus list setting updated');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update the setting'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-slate-800 bg-slate-900/40">
      <CardHeader>
        <CardTitle className="text-white">Journey Focus list</CardTitle>
        <CardDescription className="text-slate-400">
          On Deals → Journey, each stage lists Focus journeys first and keeps
          the rest under Passive. Choose whether that split is shared.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div role="radiogroup" className="space-y-2">
            {OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={scope === option.value}
                disabled={saving || !account || !canEditSettings}
                onClick={() => setScope(option.value)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50',
                  scope === option.value
                    ? 'border-primary bg-primary/10'
                    : 'border-slate-700 bg-slate-800/60 hover:border-slate-600'
                )}
              >
                <span className="block text-sm font-medium text-white">
                  {option.label}
                </span>
                <span className="block text-xs text-slate-400">
                  {option.description}
                </span>
              </button>
            ))}
          </div>
          {!canEditSettings && (
            <p className="text-xs text-slate-500">
              Only account admins can change this.
            </p>
          )}
          {canEditSettings && (
            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
