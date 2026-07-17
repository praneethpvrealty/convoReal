import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

export default function SettingsScreen() {
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Row label="Email" value={session?.user.email ?? '—'} />
        <Row label="WhatsApp number" value={session?.user.phone ?? '—'} />
        <Row label="Role" value={profile?.account_role ?? '—'} />
      </View>

      <Pressable style={styles.signOut} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>

      <Text style={styles.footer}>
        ConvoReal companion app · account management, billing and AI credits
        live in the web app.
      </Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  label: { color: colors.textMuted, fontSize: 15 },
  value: { color: colors.text, fontSize: 15, fontWeight: '500' },
  signOut: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutText: { color: colors.danger, fontSize: 16, fontWeight: '600' },
  footer: { textAlign: 'center', color: colors.textMuted, fontSize: 12 },
});
