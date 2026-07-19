import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
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
import { FilterChip, GradientHero, PrimaryButton, SectionLabel } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { ENV } from '@/lib/env';
import { chatListTime } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { onGradient, radius, shadows, spacing, useTheme , fonts } from '@/lib/theme';

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
  const { colors, fonts: f } = useTheme();
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
      style={{ flex: 1 }}
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
        }}
      />

      <GradientHero style={{ gap: 4 }}>
        <Text style={styles.heroLabel}>AI CREDITS</Text>
        <AnimatedCounter value={w?.total_credits ?? 0} style={styles.heroValue} />
        {w?.monthly_reset_at ? (
          <Text style={styles.heroSub}>
            Monthly credits refresh {chatListTime(w.monthly_reset_at)}
          </Text>
        ) : null}
      </GradientHero>

      <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
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

      <PrimaryButton
        label="Top up on the web"
        icon="flash"
        // In-app browser keeps the session warm and returns cleanly,
        // instead of dumping the user in the system browser.
        onPress={() => WebBrowser.openBrowserAsync(`${ENV.apiBaseUrl}/settings?tab=billing`)}
      />
      <Text style={{ fontSize: 11.5, color: colors.textFaint, textAlign: 'center', marginTop: -4 }}>
        Checkout opens in your browser — purchases land here instantly.
      </Text>

      <SectionLabel text="History" style={{ marginTop: spacing.sm }} />
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
        <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
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
                <Text style={{ fontSize: 13.5, fontFamily: f.semibold, color: colors.text }} numberOfLines={1}>
                  {tx.description || tx.type.replace(/_/g, ' ')}
                </Text>
                <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
                  {chatListTime(tx.created_at)} · balance {tx.balance_after}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 14.5,
                  fontFamily: f.extrabold,
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
                <Text style={{ fontSize: 13.5, fontFamily: f.bold, color: colors.primary }}>
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
  const { colors, fonts: f } = useTheme();
  return (
    <View style={[styles.breakRow, { borderTopColor: colors.border }]}>
      <Ionicons name={icon} size={17} color={muted ? colors.textFaint : colors.textMuted} />
      <Text style={{ flex: 1, fontSize: 14, color: muted ? colors.textFaint : colors.textMuted }}>
        {label}
      </Text>
      <Text
        style={{
          fontSize: 14.5,
          fontFamily: f.bold,
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
  heroLabel: {
    color: onGradient.faint,
    fontSize: 11.5,
    fontFamily: fonts.extrabold,
    letterSpacing: 1.2,
  },
  heroValue: { color: onGradient.text, fontSize: 40, fontFamily: fonts.extrabold, letterSpacing: -1 },
  heroSub: { color: onGradient.faint, fontSize: 12.5 },
  card: {
    ...shadows.card,
    borderWidth: 1,
    borderRadius: radius.lg,
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
