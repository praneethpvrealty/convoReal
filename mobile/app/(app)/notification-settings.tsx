import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { ConvoRealLoader } from '@/components/loader';
import { Banner, PrimaryButton, SectionLabel } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { haptic } from '@/lib/haptics';
import { NOTIFICATION_EVENTS } from '@/lib/notification-events';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';

type Prefs = Record<string, { app: boolean; whatsapp: boolean }>;

function catalogDefaults(): Prefs {
  const out: Prefs = {};
  for (const e of NOTIFICATION_EVENTS) out[e.key] = { ...e.defaults };
  return out;
}

async function fetchPrefs(accountId: string): Promise<Prefs> {
  const next = catalogDefaults();
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('event_key, app_enabled, whatsapp_enabled')
    .eq('account_id', accountId);
  if (error) throw error;
  for (const row of data ?? []) {
    if (next[row.event_key]) {
      next[row.event_key] = { app: row.app_enabled, whatsapp: row.whatsapp_enabled };
    }
  }
  return next;
}

export default function NotificationSettingsScreen() {
  const { colors, fonts: f } = useTheme();
  const accountId = useAuthStore((s) => s.profile?.account_id);

  const { data, isLoading } = useQuery({
    queryKey: ['notification-preferences', accountId],
    queryFn: () => fetchPrefs(accountId as string),
    enabled: Boolean(accountId),
  });

  // Local edits overlaid on the loaded prefs, so nothing is synced from
  // the query into state via an effect. `val()` reads edit-or-loaded.
  const [edits, setEdits] = useState<Prefs>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = data ?? catalogDefaults();
  function val(key: string) {
    return edits[key] ?? base[key];
  }

  const groups = useMemo(() => {
    const map = new Map<string, typeof NOTIFICATION_EVENTS>();
    for (const e of NOTIFICATION_EVENTS) {
      const list = map.get(e.group) ?? [];
      list.push(e);
      map.set(e.group, list);
    }
    return Array.from(map.entries());
  }, []);

  function set(key: string, channel: 'app' | 'whatsapp', value: boolean) {
    setSaved(false);
    setEdits((prev) => ({ ...prev, [key]: { ...val(key), [channel]: value } }));
  }

  async function save() {
    if (!accountId) return;
    setSaving(true);
    setError(null);
    const rows = NOTIFICATION_EVENTS.map((e) => ({
      account_id: accountId,
      event_key: e.key,
      app_enabled: val(e.key).app,
      whatsapp_enabled: val(e.key).whatsapp,
      updated_at: new Date().toISOString(),
    }));
    const { error: upsertError } = await supabase
      .from('notification_preferences')
      .upsert(rows, { onConflict: 'account_id,event_key' });
    setSaving(false);
    if (upsertError) {
      haptic.warn();
      setError('Could not save. Please try again.');
      return;
    }
    haptic.success();
    setSaved(true);
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Notifications' }} />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ConvoRealLoader />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textMuted }}>
            Choose how each alert reaches you. App covers the in-app bell and phone push; WhatsApp
            pings your WhatsApp number.
          </Text>

          {saved ? <Banner kind="success" text="Notification settings saved" /> : null}
          {error ? <Banner kind="error" text={error} /> : null}

          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <Ionicons name="phone-portrait-outline" size={15} color={colors.textMuted} />
              <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: f.semibold }}>App</Text>
            </View>
            <View style={styles.legendItem}>
              <Ionicons name="logo-whatsapp" size={15} color={colors.textMuted} />
              <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: f.semibold }}>
                WhatsApp
              </Text>
            </View>
          </View>

          {groups.map(([group, events]) => (
            <View key={group} style={{ gap: spacing.sm }}>
              <SectionLabel text={group} />
              <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
                {events.map((e, i) => (
                  <View
                    key={e.key}
                    style={[
                      styles.row,
                      i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null,
                    ]}
                  >
                    <View style={{ flex: 1, gap: 2, paddingRight: spacing.sm }}>
                      <Text style={{ fontSize: 14.5, fontFamily: f.bold, color: colors.text }}>
                        {e.label}
                      </Text>
                      <Text style={{ fontSize: 12, lineHeight: 16, color: colors.textMuted }}>
                        {e.description}
                      </Text>
                    </View>
                    <Switch
                      value={val(e.key).app}
                      onValueChange={(v) => set(e.key, 'app', v)}
                      trackColor={{ true: colors.primary, false: colors.border }}
                      thumbColor="#fff"
                    />
                    <Switch
                      value={val(e.key).whatsapp}
                      onValueChange={(v) => set(e.key, 'whatsapp', v)}
                      trackColor={{ true: colors.primary, false: colors.border }}
                      thumbColor="#fff"
                    />
                  </View>
                ))}
              </View>
            </View>
          ))}

          <PrimaryButton label="Save changes" busy={saving} onPress={save} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  legend: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    paddingRight: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 52, justifyContent: 'center' },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
});
