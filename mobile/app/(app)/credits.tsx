import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AnimatedCounter } from '@/components/motion';
import { FilterChip } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { ENV } from '@/lib/env';
import { chatListTime } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useBrandGradient, useTheme , fonts } from '@/lib/theme';

interface WalletRow {
  total_credits: number;
  monthly_credits: number;
  bonus_credits: number;
  referral_credits: number;
  purchased_credits: number;
  promo_credits: number;
  pending_referral_credits: number;
  monthly_reset_at: string | null;
}

interface CreditTx {
  id: string;
  type: string;
  bucket: string;
  amount: number;
  balance_after: number;
  description?: string | null;
  created_at: string;
}

interface HistoryPage {
  transactions: CreditTx[];
  page: number;
  totalPages: number;
  total: number;
}

const TX_FILTERS = ['All', 'Earned', 'Spent', 'Purchased'] as const;
type TxFilter = (typeof TX_FILTERS)[number];

const TX_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  ai_burn: 'sparkles-outline',
  purchase: 'card-outline',
  subscription_grant: 'refresh-circle-outline',
  commitment_bonus: 'gift-outline',
  referral_signup: 'people-outline',
  referral_upgrade: 'people-outline',
  referral_passive: 'people-outline',
  admin_grant: 'shield-checkmark-outline',
  promo: 'pricetag-outline',
  expiry: 'hourglass-outline',
  refund: 'arrow-undo-outline',
};

export default function CreditsScreen() {
  const { colors } = useTheme();
  const gradient = useBrandGradient();
  const [filter, setFilter] = useState<TxFilter>('All');

  const wallet = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credit_wallets')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data as WalletRow | null;
    },
  });

  const history = useInfiniteQuery({
    queryKey: ['credit-history', filter],
    queryFn: ({ pageParam }) =>
      apiFetch<HistoryPage>(
        `/api/billing/credits/history?page=${pageParam}&filter=${filter.toLowerCase()}`
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

  const transactions = history.data?.pages.flatMap((p) => p.transactions) ?? [];
  const w = wallet.data;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={wallet.isFetching}
          onRefresh={() => {
            wallet.refetch();
            history.refetch();
            queryClient.invalidateQueries({ queryKey: ['credits'] });
          }}
          tintColor={colors.primary}
        />
      }
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Billing & AI Credits',
          headerStyle: { backgroundColor: colors.tabBar },
          headerTintColor: colors.text,
        }}
      />

      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <Text style={styles.heroLabel}>AI CREDITS</Text>
        <AnimatedCounter value={w?.total_credits ?? 0} style={styles.heroValue} />
        {w?.monthly_reset_at ? (
          <Text style={styles.heroSub}>
            Monthly credits refresh {chatListTime(w.monthly_reset_at)}
          </Text>
        ) : null}
      </LinearGradient>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <BreakdownRow icon="refresh-circle-outline" label="Monthly plan" value={w?.monthly_credits} />
        <BreakdownRow icon="card-outline" label="Purchased" value={w?.purchased_credits} />
        <BreakdownRow icon="gift-outline" label="Bonus" value={w?.bonus_credits} />
        <BreakdownRow icon="people-outline" label="Referral" value={w?.referral_credits} />
        <BreakdownRow icon="pricetag-outline" label="Promo" value={w?.promo_credits} />
        {w?.pending_referral_credits ? (
          <BreakdownRow
            icon="hourglass-outline"
            label="Pending referral"
            value={w.pending_referral_credits}
            muted
          />
        ) : null}
      </View>

      <Pressable
        onPress={() => Linking.openURL(`${ENV.apiBaseUrl}/settings?tab=billing`)}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.topupButton}
        >
          <Ionicons name="flash" size={17} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 15.5, fontFamily: fonts.bold }}>
            Top up on the web
          </Text>
          <Ionicons name="open-outline" size={15} color="rgba(255,255,255,0.8)" />
        </LinearGradient>
      </Pressable>
      <Text style={{ fontSize: 11.5, color: colors.textFaint, textAlign: 'center', marginTop: -4 }}>
        Checkout opens in your browser — purchases land here instantly.
      </Text>

      <Text style={[styles.sectionLabel, { color: colors.textFaint }]}>History</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {TX_FILTERS.map((f) => (
          <FilterChip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
        ))}
      </View>

      {history.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: 24 }} />
      ) : transactions.length === 0 ? (
        <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: 16 }}>
          No transactions yet.
        </Text>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {transactions.map((tx) => (
            <View key={tx.id} style={[styles.txRow, { borderTopColor: colors.border }]}>
              <View style={[styles.txIcon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons
                  name={TX_ICONS[tx.type] ?? 'ellipse-outline'}
                  size={15}
                  color={colors.primary}
                />
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={{ fontSize: 13.5, fontFamily: fonts.semibold, color: colors.text }} numberOfLines={1}>
                  {tx.description || tx.type.replace(/_/g, ' ')}
                </Text>
                <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
                  {chatListTime(tx.created_at)} · balance {tx.balance_after}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 14.5,
                  fontFamily: fonts.extrabold,
                  color: tx.amount >= 0 ? colors.success : colors.danger,
                }}
              >
                {tx.amount >= 0 ? '+' : ''}
                {tx.amount}
              </Text>
            </View>
          ))}
          {history.hasNextPage ? (
            <Pressable
              style={{ paddingVertical: 12, alignItems: 'center' }}
              onPress={() => history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={{ fontSize: 13.5, fontFamily: fonts.bold, color: colors.primary }}>
                  Load more
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

function BreakdownRow({
  icon,
  label,
  value,
  muted,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value?: number;
  muted?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.breakRow, { borderTopColor: colors.border }]}>
      <Ionicons name={icon} size={17} color={muted ? colors.textFaint : colors.textMuted} />
      <Text style={{ flex: 1, fontSize: 14, color: muted ? colors.textFaint : colors.textMuted }}>
        {label}
      </Text>
      <Text
        style={{
          fontSize: 14.5,
          fontFamily: fonts.bold,
          color: muted ? colors.textFaint : colors.text,
        }}
      >
        {value ?? '…'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  hero: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: 4,
    elevation: 6,
    shadowColor: '#7c3aed',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  heroLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11.5,
    fontFamily: fonts.extrabold,
    letterSpacing: 1.2,
  },
  heroValue: { color: '#fff', fontSize: 40, fontFamily: fonts.extrabold, letterSpacing: -1 },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5 },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  breakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  topupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    paddingVertical: 14,
  },
  sectionLabel: {
    fontSize: 12.5,
    fontFamily: fonts.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing.sm,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  txIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
