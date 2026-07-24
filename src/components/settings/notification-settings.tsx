'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Bell, Loader2, MessageCircle, Save, Smartphone } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NOTIFICATION_EVENTS } from '@/lib/notifications/events';

type Prefs = Record<string, { app: boolean; whatsapp: boolean }>;

function defaultsFromCatalog(): Prefs {
  const out: Prefs = {};
  for (const e of NOTIFICATION_EVENTS) out[e.key] = { ...e.defaults };
  return out;
}

export function NotificationSettingsPanel() {
  const supabase = createClient();
  const { accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(defaultsFromCatalog);

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
        const { data, error } = await supabase
          .from('notification_preferences')
          .select('event_key, app_enabled, whatsapp_enabled')
          .eq('account_id', accountId);
        if (error) {
          console.error('Error loading notification preferences:', error);
          toast.error('Failed to load notification settings');
          return;
        }
        const next = defaultsFromCatalog();
        for (const row of data ?? []) {
          if (next[row.event_key]) {
            next[row.event_key] = {
              app: row.app_enabled,
              whatsapp: row.whatsapp_enabled,
            };
          }
        }
        setPrefs(next);
      } finally {
        setLoading(false);
      }
    })();
  }, [accountId, authLoading, supabase]);

  function set(key: string, channel: 'app' | 'whatsapp', value: boolean) {
    setPrefs((prev) => ({ ...prev, [key]: { ...prev[key], [channel]: value } }));
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
      const { error } = await supabase
        .from('notification_preferences')
        .upsert(rows, { onConflict: 'account_id,event_key' });
      if (error) throw error;
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
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
          <Bell className="size-5 text-primary" />
          Notifications
        </CardTitle>
        <CardDescription>
          Choose how each alert reaches you. <span className="inline-flex items-center gap-1"><Smartphone className="size-3.5" /> App</span> covers the in-app bell and phone push; <span className="inline-flex items-center gap-1"><MessageCircle className="size-3.5" /> WhatsApp</span> pings your WhatsApp number.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {groups.map(([group, events]) => (
          <div key={group} className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{group}</h3>
            <div className="rounded-xl border border-slate-800 divide-y divide-slate-800 overflow-hidden">
              {events.map((e) => (
                <div key={e.key} className="flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-100">{e.label}</p>
                    <p className="text-[12px] text-slate-400 leading-snug">{e.description}</p>
                  </div>
                  <label className="flex flex-col items-center gap-1.5 select-none">
                    <Smartphone className="size-4 text-slate-400" />
                    <Switch
                      checked={prefs[e.key].app}
                      onCheckedChange={(v) => set(e.key, 'app', v)}
                      aria-label={`${e.label} — app notifications`}
                    />
                  </label>
                  <label className="flex flex-col items-center gap-1.5 select-none">
                    <MessageCircle className="size-4 text-slate-400" />
                    <Switch
                      checked={prefs[e.key].whatsapp}
                      onCheckedChange={(v) => set(e.key, 'whatsapp', v)}
                      aria-label={`${e.label} — WhatsApp notifications`}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-end pt-2 border-t border-slate-800">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary-hover flex items-center gap-2"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save Configuration
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
