import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptic } from '@/lib/haptics';
import { PLAN_CTA, PLAN_META } from '@/lib/plan-meta';
import { fonts, radius, spacing } from '@/lib/theme';
import { useSubscription } from '@/lib/use-subscription';

/**
 * The account's subscription level, shown as a premium gradient badge on
 * the More screen. Owner-only (RLS), so it quietly hides for other roles.
 * Tapping opens Billing to manage or upgrade.
 */
export function SubscriptionCard() {
  const { plan, status, isLoading, canView } = useSubscription();
  if (!canView || isLoading || !plan) return null;

  const meta = PLAN_META[plan];
  const trialing = status === 'trialing';
  const attention = status === 'past_due' || status === 'grace_period';

  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        router.push('/(app)/credits');
      }}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label} plan — manage or upgrade`}
      style={({ pressed }) => [styles.wrap, { opacity: pressed ? 0.92 : 1 }]}
    >
      <LinearGradient
        colors={meta.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.topRow}>
          <View style={styles.iconWrap}>
            <Ionicons name={meta.icon} size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>YOUR PLAN</Text>
            <Text style={styles.plan}>{meta.label}</Text>
          </View>
          {trialing ? (
            <View style={styles.pill}>
              <Text style={styles.pillText}>Trial</Text>
            </View>
          ) : null}
          {attention ? (
            <View style={[styles.pill, { backgroundColor: 'rgba(239,68,68,0.92)' }]}>
              <Text style={styles.pillText}>Action needed</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.tagline}>{meta.tagline}</Text>
        <Text style={styles.perks}>{meta.perks}</Text>

        <View style={styles.cta}>
          <Text style={styles.ctaText}>{PLAN_CTA[plan]}</Text>
          <Ionicons name="arrow-forward" size={15} color="#fff" />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden' },
  card: { padding: spacing.lg, gap: 6 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: { fontSize: 11, fontFamily: fonts.bold, color: 'rgba(255,255,255,0.75)', letterSpacing: 1 },
  plan: { fontSize: 24, fontFamily: fonts.extrabold, color: '#fff', letterSpacing: -0.4 },
  tagline: { fontSize: 13.5, fontFamily: fonts.semibold, color: 'rgba(255,255,255,0.92)', marginTop: 2 },
  perks: { fontSize: 12, fontFamily: fonts.medium, color: 'rgba(255,255,255,0.78)' },
  pill: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: { fontSize: 11, fontFamily: fonts.bold, color: '#fff' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ctaText: { fontSize: 13, fontFamily: fonts.bold, color: '#fff' },
});
