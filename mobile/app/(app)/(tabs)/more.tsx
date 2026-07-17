import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useCredits } from '@/lib/use-credits';

/** Features that stay on the web (per the mobile plan's scoping). */
const WEB_ONLY = [
  { icon: 'git-branch-outline', label: 'Automations & Flow Builder' },
  { icon: 'megaphone-outline', label: 'Broadcast Campaigns' },
  { icon: 'map-outline', label: 'Journey Mind Map' },
  { icon: 'stats-chart-outline', label: 'Dashboard & Pulse Analytics' },
  { icon: 'card-outline', label: 'Billing & AI Credit Top-ups' },
  { icon: 'people-circle-outline', label: 'Team & Workspace Settings' },
] as const;

export default function MoreScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const credits = useCredits();

  const displayName = session?.user.email?.split('@')[0] ?? 'Account';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.sm }]}
    >
      <Text style={[styles.title, { color: colors.text }]}>More</Text>

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
        <InfoRow
          icon="logo-whatsapp"
          label="WhatsApp number"
          value={session?.user.phone ? `+${session.user.phone.replace(/^\+/, '')}` : 'Not set'}
        />
        <InfoRow
          icon="flash-outline"
          label="AI credits"
          value={credits.isLoading ? '…' : String(credits.total)}
        />
      </View>

      <SectionLabel text="Workspace" />
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Link href="/(app)/calendar" asChild>
          <Pressable style={styles.navRow} android_ripple={{ color: colors.border }}>
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            <Text style={[styles.navLabel, { color: colors.text }]}>Calendar & Site Visits</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
          </Pressable>
        </Link>
      </View>

      <SectionLabel text="On the web app" />
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {WEB_ONLY.map((f) => (
          <View key={f.label} style={styles.navRow}>
            <Ionicons name={f.icon} size={19} color={colors.textMuted} />
            <Text style={[styles.navLabel, { color: colors.textMuted }]}>{f.label}</Text>
            <Ionicons name="globe-outline" size={15} color={colors.textFaint} />
          </View>
        ))}
        <Text style={[styles.cardHint, { color: colors.textFaint }]}>
          These need a bigger screen or are deliberately web-only — open the web app to use them.
        </Text>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.signOut,
          { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={() => supabase.auth.signOut()}
      >
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={{ color: colors.danger, fontSize: 15.5, fontWeight: '700' }}>Sign out</Text>
      </Pressable>

      <Text style={[styles.footer, { color: colors.textFaint }]}>
        ConvoReal companion · v{Constants.expoConfig?.version ?? '0.1.0'}
      </Text>
    </ScrollView>
  );
}

function SectionLabel({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        fontSize: 12.5,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        color: colors.textFaint,
        marginTop: spacing.sm,
      }}
    >
      {text}
    </Text>
  );
}

function InfoRow({
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
    <View style={[styles.infoRow, { borderTopColor: colors.border }]}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={{ flex: 1, fontSize: 14.5, color: colors.textMuted }}>{label}</Text>
      <Text style={{ fontSize: 14.5, fontWeight: '600', color: colors.text }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
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
  roleChip: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  navLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
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
    marginTop: spacing.sm,
  },
  footer: { fontSize: 12, textAlign: 'center', marginTop: spacing.sm },
});
