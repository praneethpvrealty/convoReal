import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/app/(app)/(tabs)/_layout';
import { ProfileEditSheet } from '@/components/profile-edit-sheet';
import { SubscriptionCard } from '@/components/subscription-card';
import { Avatar, SectionLabel } from '@/components/ui';
import { authenticate, biometricsAvailable, useAppLock } from '@/lib/app-lock';
import { signOut, useAuthStore } from '@/lib/auth-store';
import {
  fonts,
  radius,
  spacing,
  useAppearance,
  useTheme,
  type AppearanceMode,
} from '@/lib/theme';
import { useCredits } from '@/lib/use-credits';

const WORKSPACE_LINKS = [
  { href: '/(app)/dashboard', icon: 'stats-chart-outline', label: 'Overview & Stats' },
  { href: '/(app)/notification-settings', icon: 'notifications-outline', label: 'Notifications' },
  { href: '/(app)/calendar', icon: 'calendar-outline', label: 'Calendar & Site Visits' },
  { href: '/(app)/credits', icon: 'flash-outline', label: 'Billing & AI Credits' },
  { href: '/(app)/journey', icon: 'map-outline', label: 'Journeys' },
  { href: '/(app)/broadcasts', icon: 'megaphone-outline', label: 'Broadcast Campaigns' },
  { href: '/(app)/automations', icon: 'git-branch-outline', label: 'Automations & Flows' },
  { href: '/(app)/connection-check', icon: 'pulse-outline', label: 'Connection check' },
] as const;

/** Deliberately web-only (canvas editors, admin surface). */
const WEB_ONLY = [
  { icon: 'construct-outline', label: 'Flow & Automation Builders' },
  { icon: 'people-circle-outline', label: 'Team & Workspace Settings' },
] as const;

export default function MoreScreen() {
  const { colors, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const credits = useCredits();
  const [editOpen, setEditOpen] = useState(false);

  const displayName =
    profile?.full_name?.trim() || session?.user.email?.split('@')[0] || 'Account';

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.sm }]}
    >
      <Text style={[styles.title, { color: colors.text, fontFamily: f.extrabold }]}>More</Text>

      <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
        <Pressable
          style={styles.profileRow}
          onPress={() => setEditOpen(true)}
          android_ripple={{ color: colors.border }}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
        >
          <Avatar name={displayName} size={54} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 17, fontFamily: f.bold, color: colors.text }} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={{ fontSize: 13, color: colors.textMuted }} numberOfLines={1}>
              {session?.user.email ?? '—'}
            </Text>
          </View>
          <View style={[styles.roleChip, { backgroundColor: colors.primarySoft }]}>
            <Text style={{ fontSize: 12, fontFamily: f.bold, color: colors.primary }}>
              {profile?.account_role ?? '—'}
            </Text>
          </View>
          <Ionicons name="pencil-outline" size={16} color={colors.textFaint} />
        </Pressable>
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

      <SubscriptionCard />

      <SectionLabel text="Workspace" style={{ marginTop: spacing.sm }} />
      <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
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

      <SectionLabel text="Appearance" style={{ marginTop: spacing.sm }} />
      <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
        <AppearancePicker />
      </View>

      <SectionLabel text="Security" style={{ marginTop: spacing.sm }} />
      <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
        <BiometricLockRow />
      </View>

      <SectionLabel text="On the web app" style={{ marginTop: spacing.sm }} />
      <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
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
          { backgroundColor: colors.glass, borderColor: colors.glassBorder, opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={() => signOut()}
      >
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={{ color: colors.danger, fontSize: 15.5, fontFamily: f.bold }}>Sign out</Text>
      </Pressable>

      <Text style={[styles.footer, { color: colors.textFaint }]}>
        ConvoReal companion · v{Constants.expoConfig?.version ?? '0.1.0'}
      </Text>

      <ProfileEditSheet visible={editOpen} onClose={() => setEditOpen(false)} />
    </ScrollView>
  );
}

const APPEARANCE_OPTIONS: {
  value: AppearanceMode;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
];

/** The reference design is light-first; dark stays a choice. */
function AppearancePicker() {
  const { colors, fonts: f } = useTheme();
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
            accessibilityRole="button"
            accessibilityLabel={`${opt.label} appearance`}
            accessibilityState={{ selected: active }}
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
              name={opt.icon}
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

/**
 * "Unlock with fingerprint" switch. Enabling requires biometrics to be
 * enrolled AND one successful OS prompt (proves the sensor path works
 * before the app starts locking behind it); disabling re-confirms too.
 */
function BiometricLockRow() {
  const { colors } = useTheme();
  const enabled = useAppLock((s) => s.enabled);
  const setEnabled = useAppLock((s) => s.setEnabled);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (next && !(await biometricsAvailable())) {
        Alert.alert(
          'No fingerprint set up',
          'Add a fingerprint or face unlock in your phone settings first — or this build may not support it yet (install the latest app version).'
        );
        return;
      }
      const ok = await authenticate();
      if (ok) setEnabled(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.navRow}>
      <Ionicons name="finger-print-outline" size={20} color={colors.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.navLabel, { color: colors.text }]}>Unlock with fingerprint</Text>
        <Text style={{ fontSize: 12, lineHeight: 16, color: colors.textMuted }}>
          Require your fingerprint or face each time the app opens.
        </Text>
      </View>
      <Switch
        value={enabled}
        disabled={busy}
        onValueChange={toggle}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor="#fff"
      />
    </View>
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
  const { colors, fonts: f } = useTheme();
  return (
    <View style={[styles.infoRow, { borderTopColor: colors.border }]}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={{ flex: 1, fontSize: 14.5, color: colors.textMuted }}>{label}</Text>
      <Text style={{ fontSize: 14.5, fontFamily: f.semibold, color: colors.text }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: TAB_BAR_CLEARANCE + spacing.sm },
  title: { fontSize: 30, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
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
