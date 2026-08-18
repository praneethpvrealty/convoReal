'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Bell,
  Clock3,
  Loader2,
  MessageCircle,
  Save,
  Smartphone,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';

type Prefs = Record<string, { app: boolean; whatsapp: boolean }>;
type QuietSettings = {
  clientEnabled: boolean;
  clientStart: string;
  clientEnd: string;
  agentEnabled: boolean;
  agentStart: string;
  agentEnd: string;
};

const DEFAULT_QUIET_SETTINGS: QuietSettings = {
  clientEnabled: true,
  clientStart: '21:00',
  clientEnd: '08:00',
  agentEnabled: true,
  agentStart: '22:00',
  agentEnd: '07:00',
};

function defaultsFromCatalog(): Prefs {
  const out: Prefs = {};
  for (const e of NOTIFICATION_EVENTS) out[e.key] = { ...e.defaults };
  return out;
}

export function NotificationSettingsPanel() {
  const supabase = createClient();
  const { accountId, canEditSettings, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(defaultsFromCatalog);
  const [quiet, setQuiet] = useState<QuietSettings>(DEFAULT_QUIET_SETTINGS);

  const groups = useMemo(() => {
    const map = new Map<string, typeof NOTIFICATION_EVENTS>();
    for (const e of NOTIFICATION_EVENTS) {
      const list = map.get(e.group) ?? [];
      list.push(e);
      map.set(e.group, list);
    }
    return Array.from(map.entries());
  }, []);

  useEffect(() => {
    if (authLoading || !accountId) return;
    (async () => {
      try {
        const [prefsResult, quietResult] = await Promise.all([
          supabase
            .from('notification_preferences')
            .select('event_key, app_enabled, whatsapp_enabled')
            .eq('account_id', accountId),
          supabase
            .from('accounts')
            .select(
              'client_quiet_hours_enabled, client_quiet_hours_start, client_quiet_hours_end, agent_quiet_hours_enabled, agent_quiet_hours_start, agent_quiet_hours_end'
            )
            .eq('id', accountId)
            .single(),
        ]);
        if (prefsResult.error || quietResult.error) {
          console.error(
            'Error loading notification preferences:',
            prefsResult.error || quietResult.error
          );
          toast.error('Failed to load notification settings');
          return;
        }
        const next = defaultsFromCatalog();
        for (const row of prefsResult.data ?? []) {
          if (next[row.event_key]) {
            next[row.event_key] = {
              app: row.app_enabled,
              whatsapp: row.whatsapp_enabled,
            };
          }
        }
        setPrefs(next);
        const row = quietResult.data;
        setQuiet({
          clientEnabled: row.client_quiet_hours_enabled,
          clientStart: row.client_quiet_hours_start.slice(0, 5),
          clientEnd: row.client_quiet_hours_end.slice(0, 5),
          agentEnabled: row.agent_quiet_hours_enabled,
          agentStart: row.agent_quiet_hours_start.slice(0, 5),
          agentEnd: row.agent_quiet_hours_end.slice(0, 5),
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [accountId, authLoading, supabase]);

  function set(key: string, channel: 'app' | 'whatsapp', value: boolean) {
    setPrefs((prev) => ({
      ...prev,
      [key]: { ...prev[key], [channel]: value },
    }));
  }

  async function handleSave() {
    if (!accountId) return;
    setSaving(true);
    try {
      const rows = NOTIFICATION_EVENTS.map((e) => ({
        account_id: accountId,
        event_key: e.key,
        app_enabled: prefs[e.key].app,
        whatsapp_enabled: prefs[e.key].whatsapp,
        updated_at: new Date().toISOString(),
      }));
      const [prefsResult, quietResult] = await Promise.all([
        supabase
          .from('notification_preferences')
          .upsert(rows, { onConflict: 'account_id,event_key' }),
        supabase
          .from('accounts')
          .update({
            client_quiet_hours_enabled: quiet.clientEnabled,
            client_quiet_hours_start: quiet.clientStart,
            client_quiet_hours_end: quiet.clientEnd,
            agent_quiet_hours_enabled: quiet.agentEnabled,
            agent_quiet_hours_start: quiet.agentStart,
            agent_quiet_hours_end: quiet.agentEnd,
          })
          .eq('id', accountId)
          .select('id')
          .single(),
      ]);
      if (prefsResult.error || quietResult.error) {
        throw prefsResult.error || quietResult.error;
      }
      toast.success('Notification settings saved');
    } catch (err) {
      console.error('Error saving notification preferences:', err);
      toast.error('Failed to save notification settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading || authLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="text-primary size-8 animate-spin" />
      </div>
    );
  }

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl font-bold text-white">
          <Bell className="text-primary size-5" />
          Notifications
        </CardTitle>
        <CardDescription>
          Choose how each alert reaches you.{' '}
          <span className="inline-flex items-center gap-1">
            <Smartphone className="size-3.5" /> App
          </span>{' '}
          covers the in-app bell and phone push;{' '}
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="size-3.5" /> WhatsApp
          </span>{' '}
          pings your WhatsApp number.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
              <Clock3 className="text-primary size-4" /> Quiet hours (IST)
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              WhatsApp and push reminders wait until quiet hours end. In-app
              reminders still appear on time.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['client', 'Clients', 'Appointment reminders sent to clients'],
                [
                  'agent',
                  'You & agents',
                  'Your own task and calendar reminders',
                ],
              ] as const
            ).map(([audience, label, description]) => {
              const enabledKey = `${audience}Enabled` as const;
              const startKey = `${audience}Start` as const;
              const endKey = `${audience}End` as const;
              return (
                <div
                  key={audience}
                  className="rounded-xl border border-slate-800 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">
                        {label}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {description}
                      </p>
                    </div>
                    <Switch
                      checked={quiet[enabledKey]}
                      onCheckedChange={(value) =>
                        setQuiet((current) => ({
                          ...current,
                          [enabledKey]: value,
                        }))
                      }
                      disabled={!canEditSettings}
                      aria-label={`${label} quiet hours`}
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="time"
                      value={quiet[startKey]}
                      onChange={(event) =>
                        setQuiet((current) => ({
                          ...current,
                          [startKey]: event.target.value,
                        }))
                      }
                      disabled={!quiet[enabledKey] || !canEditSettings}
                      className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
                      aria-label={`${label} quiet hours start`}
                    />
                    <span className="text-xs text-slate-500">to</span>
                    <input
                      type="time"
                      value={quiet[endKey]}
                      onChange={(event) =>
                        setQuiet((current) => ({
                          ...current,
                          [endKey]: event.target.value,
                        }))
                      }
                      disabled={!quiet[enabledKey] || !canEditSettings}
                      className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
                      aria-label={`${label} quiet hours end`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {groups.map(([group, events]) => (
          <div key={group} className="space-y-2">
            <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
              {group}
            </h3>
            <div className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800">
              {events.map((e) => (
                <div key={e.key} className="flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-100">
                      {e.label}
                    </p>
                    <p className="text-[12px] leading-snug text-slate-400">
                      {e.description}
                    </p>
                  </div>
                  <label className="flex flex-col items-center gap-1.5 select-none">
                    <Smartphone className="size-4 text-slate-400" />
                    <Switch
                      checked={prefs[e.key].app}
                      onCheckedChange={(v) => set(e.key, 'app', v)}
                      disabled={!canEditSettings}
                      aria-label={`${e.label} — app notifications`}
                    />
                  </label>
                  <label className="flex flex-col items-center gap-1.5 select-none">
                    <MessageCircle className="size-4 text-slate-400" />
                    <Switch
                      checked={prefs[e.key].whatsapp}
                      onCheckedChange={(v) => set(e.key, 'whatsapp', v)}
                      disabled={!canEditSettings}
                      aria-label={`${e.label} — WhatsApp notifications`}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-end border-t border-slate-800 pt-2">
          <Button
            onClick={handleSave}
            disabled={saving || !canEditSettings}
            className="bg-primary text-primary-foreground hover:bg-primary-hover flex items-center gap-2"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save Configuration
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
