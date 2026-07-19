import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { apiBase } from '@/lib/api';
import { ENV } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme , fonts } from '@/lib/theme';

interface CheckRow {
  label: string;
  value: string;
  ok?: boolean;
}

/**
 * Support tool: runs the auth/API probes that discriminate between
 * the failure modes behind "Unauthorized" — wrong Supabase project,
 * revoked session, redirect header-stripping, or a server-side auth
 * problem — and shows one screen to screenshot.
 */
export default function ConnectionCheckScreen() {
  const { colors, fonts: f } = useTheme();
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    (async () => {
      const out: CheckRow[] = [];
      const push = (label: string, value: string, ok?: boolean) => {
        out.push({ label, value, ok });
        setRows([...out]);
      };

      push('Supabase project', new URL(ENV.supabaseUrl).host);
      push('API base (configured)', ENV.apiBaseUrl);
      push('API base (pinned)', apiBase());

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        push('Session', 'none — signed out', false);
        setRunning(false);
        return;
      }
      push('Signed in as', session.user.phone || session.user.email || session.user.id, true);
      const expMin = session.expires_at
        ? Math.round((session.expires_at * 1000 - Date.now()) / 60000)
        : null;
      push('Access token expires', expMin === null ? 'unknown' : `${expMin} min`, (expMin ?? 0) > 0);

      // Device → GoTrue directly: is this token valid for the project
      // the APP is configured against?
      const { error: getUserError } = await supabase.auth.getUser();
      push(
        'Token valid at app project',
        getUserError ? `NO — ${getUserError.message}` : 'yes',
        !getUserError
      );

      // Device → GoTrue refresh: does the refresh token still work?
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      push(
        'Refresh token',
        refreshError ? `dead — ${refreshError.message}` : 'works',
        !refreshError
      );
      const token = refreshed?.session?.access_token ?? session.access_token;

      // Server probes with the freshest token, both hosts.
      const probe = async (base: string) => {
        try {
          const res = await fetch(`${base}/api/properties?page=0&limit=1`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          return `HTTP ${res.status}`;
        } catch (e) {
          return `network error: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      };
      const configured = await probe(ENV.apiBaseUrl);
      push('API with token (configured base)', configured, configured === 'HTTP 200');
      try {
        const u = new URL(ENV.apiBaseUrl);
        if (!u.hostname.startsWith('www.')) {
          u.hostname = `www.${u.hostname}`;
          const www = await probe(u.origin);
          push('API with token (www base)', www, www === 'HTTP 200');
        }
      } catch {
        // apiBaseUrl unparsable — already visible above.
      }

      setRunning(false);
    })();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Connection check' }} />
      <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
        {rows.map((r) => (
          <View key={r.label} style={[styles.row, { borderTopColor: colors.border }]}>
            <Text style={{ fontSize: 12, color: colors.textFaint }}>{r.label}</Text>
            <Text
              style={{
                fontSize: 14,
                fontFamily: f.semibold,
                color: r.ok === undefined ? colors.text : r.ok ? colors.success : colors.danger,
              }}
            >
              {r.value}
            </Text>
          </View>
        ))}
        {running ? (
          <Text style={{ fontSize: 12.5, color: colors.textMuted, padding: spacing.md }}>
            Running checks…
          </Text>
        ) : null}
      </View>
      <Text style={{ fontSize: 12, color: colors.textFaint, lineHeight: 17 }}>
        Reading this: if "Token valid at app project" is green but the API probes are red, the
        server and app point at different Supabase projects (or the server rejects the header).
        If it's red with a dead refresh token, sign out and back in. Screenshot this screen when
        reporting connection problems.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: {
    gap: 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
