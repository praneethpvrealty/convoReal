'use client';

// Buyer portal — notification preferences.

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useBuyer, type BuyerMe } from './buyer-provider';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface BuyerSettings {
  display_name: string | null;
  notify_matches: boolean;
  alerts_enabled: boolean;
}

export function BuyerSettingsContent() {
  const { me, refresh } = useBuyer();
  const [settings, setSettings] = useState<BuyerSettings | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/buyer/settings');
      if (!res.ok) {
        toast.error('Could not load settings');
        return;
      }
      setSettings((await res.json()) as BuyerSettings);
    })();
  }, []);

  if (!me || !settings) {
    return <p className="text-muted-foreground text-sm">Loading settings…</p>;
  }
  return (
    <BuyerSettingsForm
      key={me.buyer_user_id}
      me={me}
      initial={settings}
      refresh={refresh}
    />
  );
}

function BuyerSettingsForm({
  me,
  initial,
  refresh,
}: {
  me: BuyerMe;
  initial: BuyerSettings;
  refresh: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(initial.display_name || '');
  const [notifyMatches, setNotifyMatches] = useState(initial.notify_matches);
  const [alertsEnabled, setAlertsEnabled] = useState(initial.alerts_enabled);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch('/api/buyer/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: displayName,
        notify_matches: notifyMatches,
        alerts_enabled: alertsEnabled,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error || 'Could not save settings');
      return;
    }
    await refresh();
    toast.success('Settings saved.');
  };

  return (
    <form
      onSubmit={handleSave}
      className="mx-auto flex max-w-xl flex-col gap-4"
    >
      <div>
        <h1 className="text-xl font-black tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm font-medium">
          Signed in with WhatsApp number {me.phone}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="s-name" className="text-xs font-bold">
              Your name
            </Label>
            <Input
              id="s-name"
              placeholder="How should we greet you?"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Notifications</CardTitle>
          <CardDescription className="text-xs">
            Delivered on WhatsApp and shown in the portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold">New match alerts</p>
              <p className="text-muted-foreground text-[11px]">
                When a new property matches your preferences.
              </p>
            </div>
            <Switch
              checked={notifyMatches}
              onCheckedChange={setNotifyMatches}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold">WhatsApp property alerts</p>
              <p className="text-muted-foreground text-[11px]">
                Turning this off also stops the alerts your agencies send. You
                can reply STOP ALERTS on WhatsApp anytime for the same effect.
              </p>
            </div>
            <Switch
              checked={alertsEnabled}
              onCheckedChange={setAlertsEnabled}
            />
          </div>
        </CardContent>
      </Card>

      {me.links.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Your agencies</CardTitle>
            <CardDescription className="text-xs">
              Agencies you&apos;re house-hunting with.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {me.links.map((l) => (
              <div
                key={l.account_id}
                className="bg-muted/30 rounded-lg border px-3 py-2 text-xs font-semibold"
              >
                {l.agency_name || 'Agency'}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Button type="submit" disabled={saving} className="text-xs font-bold">
        {saving ? 'Saving…' : 'Save settings'}
      </Button>
    </form>
  );
}
