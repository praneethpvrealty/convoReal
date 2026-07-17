import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useCredits } from '@/lib/use-credits';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const credits = useCredits();

  const displayName = session?.user.email?.split('@')[0] ?? 'Account';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[styles.title, { color: colors.text }]}>Settings</Text>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.profileRow}>
          <Avatar name={displayName} size={54} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={{ fontSize: 13, color: colors.textMuted }} numberOfLines={1}>
              {session?.user.email ?? '—'}
            </Text>
          </View>
          <View style={[styles.roleChip, { backgroundColor: colors.primarySoft }]}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>
              {profile?.account_role ?? '—'}
            </Text>
          </View>
        </View>
        <Row
          icon="logo-whatsapp"
          label="WhatsApp number"
          value={session?.user.phone ? `+${session.user.phone.replace(/^\+/, '')}` : 'Not set'}
        />
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Row
          icon="flash-outline"
          label="AI credits"
          value={credits.isLoading ? '…' : String(credits.total)}
        />
        <Text style={[styles.cardHint, { color: colors.textFaint }]}>
          {credits.total === 0
            ? 'Out of credits — AI features are locked. Top up from the web app.'
            : 'Credit top-ups and plan management live in the web app.'}
        </Text>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.signOut,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
        onPress={() => supabase.auth.signOut()}
      >
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={{ color: colors.danger, fontSize: 15.5, fontWeight: '700' }}>Sign out</Text>
      </Pressable>

      <Text style={[styles.footer, { color: colors.textFaint }]}>
        ConvoReal companion · v{Constants.expoConfig?.version ?? '0.1.0'}
        {'\n'}Account management, billing and inventory editing live on the web.
      </Text>
    </ScrollView>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: colors.border }]}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={{ flex: 1, fontSize: 14.5, color: colors.textMuted }}>{label}</Text>
      <Text style={{ fontSize: 14.5, fontWeight: '600', color: colors.text }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingTop: 54, gap: spacing.lg },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  roleChip: {
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cardHint: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 15,
  },
  footer: { fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: spacing.sm },
});
