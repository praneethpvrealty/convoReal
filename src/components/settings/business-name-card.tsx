'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

/** Mirrors MAX_NAME_LEN in /api/account. */
const MAX_NAME_LEN = 80;

/**
 * Renames the account (workspace) via PATCH /api/account. Lives on the
 * Profile tab because that's where people go after noticing the wrong
 * name in a client-facing message — the personal display name above
 * does NOT feed those messages; this field does.
 */
export function BusinessNameCard() {
  const { account, canEditSettings, refreshProfile } = useAuth();

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  // Seed once the account summary loads (and re-seed after saves).
  useEffect(() => {
    if (account?.name) setName(account.name);
  }, [account?.name]);

  const dirty = !!account && name.trim() !== account.name && name.trim().length > 0;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Business name cannot be empty');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Request failed');
      }

      await refreshProfile();
      toast.success('Business name updated', {
        description: 'New client-facing messages will use it right away.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update business name');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-slate-900/40 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white">Business name</CardTitle>
        <CardDescription className="text-slate-400">
          The name your clients see — it appears in WhatsApp meeting reminders
          (&ldquo;a friendly reminder from &hellip;&rdquo;) and other client-facing
          messages. This is separate from your personal display name above.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="business-name" className="text-slate-200">
              Business name
            </Label>
            <Input
              id="business-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={account ? 'e.g. Praneeth Kumar Realty' : 'Loading…'}
              maxLength={MAX_NAME_LEN}
              disabled={saving || !account || !canEditSettings}
              required
            />
            {!canEditSettings && (
              <p className="text-xs text-slate-500">
                Only account admins can change the business name.
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
                  'Save business name'
                )}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
