import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import {
  fonts,
  radius,
  shadows,
  spacing,
  useAppearance,
  useTheme,
  type AppearanceMode,
} from '@/lib/theme';
import { useCredits } from '@/lib/use-credits';

const WORKSPACE_LINKS = [
  { href: '/(app)/dashboard', icon: 'stats-chart-outline', label: 'Overview & Stats' },
  { href: '/(app)/calendar', icon: 'calendar-outline', label: 'Calendar & Site Visits' },
  { href: '/(app)/credits', icon: 'flash-outline', label: 'Billing & AI Credits' },
  { href: '/(app)/journey', icon: 'map-outline', label: 'Journeys' },
  { href: '/(app)/broadcasts', icon: 'megaphone-outline', label: 'Broadcast Campaigns' },
  { href: '/(app)/automations', icon: 'git-branch-outline', label: 'Automations & Flows' },
] as const;

/** Deliberately web-only (canvas editors, admin surface). */
const WEB_ONLY = [
  { icon: 'construct-outline', label: 'Flow & Automation Builders' },
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

      <View style={[styles.card, shadows.card, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
        <View style={styles.profileRow}>
          <Avatar name={displayName} size={54} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 17, fontFamily: fonts.bold, color: colors.text }} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={{ fontSize: 13, color: colors.textMuted }} numberOfLines={1}>
              {session?.user.email ?? '—'}
            </Text>
          </View>
          <View style={[styles.roleChip, { backgroundColor: colors.primarySoft }]}>
            <Text style={{ fontSize: 12, fontFamily: fonts.bold, color: colors.primary }}>
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
      <View style={[styles.card, shadows.card, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
        {WORKSPACE_LINKS.map((link) => (
          <Link key={link.href} href={link.href} asChild>
            <Pressable style={styles.navRow} android_ripple={{ color: colors.border }}>
              <Ionicons name={link.icon} size={20} color={colors.primary} />
              <Text style={[styles.navLabel, { color: colors.text }]}>{link.label}</Text>
              <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
            </Pressable>
          </Link>
        ))}
      </View>

      <SectionLabel text="Appearance" />
      <View style={[styles.card, shadows.card, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
        <AppearancePicker />
      </View>

      <SectionLabel text="On the web app" />
      <View style={[styles.card, shadows.card, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
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
        <Text style={{ color: colors.danger, fontSize: 15.5, fontFamily: fonts.bold }}>Sign out</Text>
      </Pressable>

      <Text style={[styles.footer, { color: colors.textFaint }]}>
        ConvoReal companion · v{Constants.expoConfig?.version ?? '0.1.0'}
      </Text>
    </ScrollView>
  );
}

const APPEARANCE_OPTIONS: { value: AppearanceMode; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
];

/** The reference design is light-first; dark stays a choice. */
function AppearancePicker() {
  const { colors } = useTheme();
  const mode = useAppearance((s) => s.mode);
  const setMode = useAppearance((s) => s.setMode);
  return (
    <View style={{ flexDirection: 'row', padding: spacing.sm, gap: spacing.sm }}>
      {APPEARANCE_OPTIONS.map((opt) => {
        const active = mode === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => setMode(opt.value)}
            style={{
              flex: 1,
              alignItems: 'center',
              gap: 4,
              paddingVertical: 10,
              borderRadius: radius.md,
              backgroundColor: active ? colors.primarySoft : 'transparent',
              borderWidth: active ? 1 : 0,
              borderColor: colors.primary,
            }}
          >
            <Ionicons
              name={opt.icon as never}
              size={18}
              color={active ? colors.primary : colors.textMuted}
            />
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: active ? fonts.bold : fonts.medium,
                color: active ? colors.primary : colors.textMuted,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        fontSize: 12.5,
        fontFamily: fonts.bold,
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
      <Text style={{ fontSize: 14.5, fontFamily: fonts.semibold, color: colors.text }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: 120 },
  title: { fontSize: 30, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
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
  navLabel: { flex: 1, fontSize: 15.5, fontFamily: fonts.bold },
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
