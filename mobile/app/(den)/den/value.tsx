import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  VALUE_SOURCE_LABELS,
  valuedSummary,
  type PropertyValue,
} from '@shared/lib/den/value-view';
import { MIN_MARKET_COMPARABLES } from '@shared/lib/market/valuation';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import {
  Banner,
  EmptyState,
  PriceHint,
  PrimaryButton,
  TextField,
} from '@/components/ui';
import { ApiError } from '@/lib/api';
import { fetchDenValue, saveDenDeclaredValue } from '@/lib/den-api';
import { friendlyError } from '@/lib/errors';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';
import { usePullRefresh } from '@/lib/use-pull-refresh';

/**
 * Portfolio value — what the owner's properties are worth, from their
 * own figure, the government guidance value and a market range. Mirrors
 * the value card and panel on the web Portfolio; every number comes
 * from GET /api/den/value.
 */
export default function DenValueScreen() {
  const { colors, fonts: f } = useTheme();
  const value = useQuery({ queryKey: ['den-value'], queryFn: fetchDenValue });
  const pull = usePullRefresh(() => value.refetch());
  const totals = value.data?.totals;
  const properties = value.data?.properties ?? [];

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      {value.error ? (
        <Banner
          kind="error"
          text={friendlyError(
            value.error instanceof ApiError
              ? value.error.message
              : 'Could not load your portfolio value.'
          )}
        />
      ) : null}

      {totals ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.glass, borderColor: colors.primary },
          ]}
        >
          <Text style={{ fontSize: 12, color: colors.textMuted }}>
            Portfolio value
          </Text>
          <Text
            style={{
              fontSize: 26,
              fontFamily: f.extrabold,
              color: colors.text,
            }}
          >
            {totals.valued > 0 ? formatInr(totals.estimate) : '—'}
          </Text>
          <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
            {valuedSummary(totals, value.data?.truncated)}
          </Text>
          {totals.guidance_count > 0 ? (
            <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
              Guidance value {formatInr(totals.guidance)} (
              {totals.guidance_count})
            </Text>
          ) : null}
          {totals.market_count > 0 ? (
            <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
              Market range {formatInr(totals.market_low)} –{' '}
              {formatInr(totals.market_high)} ({totals.market_count})
            </Text>
          ) : null}
        </View>
      ) : null}

      {value.isLoading ? null : properties.length === 0 && !value.error ? (
        <EmptyState
          icon="home-outline"
          title="No properties to value yet"
          subtitle="Once your agency links a property to your WhatsApp number, its value appears here."
        />
      ) : (
        properties.map((p) => (
          <PropertyValueCard
            key={`${p.property_id}-${p.declared ?? 'unset'}`}
            value={p}
          />
        ))
      )}
    </ScrollView>
  );
}

function PropertyValueCard({ value }: { value: PropertyValue }) {
  const { colors, fonts: f } = useTheme();
  const { show, dialogProps } = useAppDialog();
  const [declared, setDeclared] = useState(
    value.declared ? String(value.declared) : ''
  );

  const save = useMutation({
    mutationFn: (amount: number | null) =>
      saveDenDeclaredValue(value.property_id, amount),
    onSuccess: (fresh) => {
      haptic.success();
      queryClient.setQueryData(['den-value'], fresh);
    },
    onError: (e) => {
      haptic.warn();
      show({
        title: 'Could not save',
        message: friendlyError(
          e instanceof ApiError ? e.message : 'Try again.'
        ),
      });
    },
  });

  function submit() {
    const cleaned = declared.replace(/[,\s₹]/g, '');
    if (!cleaned) {
      save.mutate(null);
      return;
    }
    const amount = Number(cleaned);
    if (!Number.isFinite(amount) || amount <= 0) {
      show({
        title: 'Check the value',
        message: 'Enter a value in rupees, for example 8500000.',
      });
      return;
    }
    save.mutate(amount);
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <Text
        style={{ fontSize: 15, fontFamily: f.bold, color: colors.text }}
        numberOfLines={2}
      >
        {value.title || 'Your property'}
      </Text>
      {value.agency_name ? (
        <Text style={{ fontSize: 12, color: colors.textMuted }}>
          Managed by {value.agency_name}
        </Text>
      ) : null}

      <TextField
        label={`${VALUE_SOURCE_LABELS.declared} (₹)`}
        placeholder={
          value.asking
            ? `Using your expected price, ${formatInr(value.asking)}`
            : 'What you believe it is worth today'
        }
        keyboardType="number-pad"
        value={declared}
        onChangeText={setDeclared}
      />
      <PriceHint value={declared} />
      <Text style={{ fontSize: 12, color: colors.textFaint }}>
        Only you see this figure. It is not shown to your agency or to buyers.
        Clear the box and save to remove it.
      </Text>
      <PrimaryButton label="Save" onPress={submit} busy={save.isPending} />

      <ValueLine
        label={VALUE_SOURCE_LABELS.guidance}
        text={
          value.guidance
            ? `${formatInr(value.guidance.total)}, the government value on file for this property. A sale cannot be registered below it.`
            : 'Not on file for this property yet. Use Find a guidance value on the Portfolio home.'
        }
      />
      <ValueLine
        label={VALUE_SOURCE_LABELS.market}
        text={
          value.market
            ? `${formatInr(value.market.low)} – ${formatInr(value.market.high)}, from ${value.market.comparables} comparable listings in this locality. Asking prices, not registered sales.`
            : `No market range yet. We show one only when at least ${MIN_MARKET_COMPARABLES} comparable listings in this locality have a price and an area.`
        }
      />
      <Text
        style={{ fontSize: 12.5, fontFamily: f.semibold, color: colors.text }}
      >
        {value.estimate !== null && value.estimate_source
          ? `Counted in your portfolio at ${formatInr(value.estimate)} (${VALUE_SOURCE_LABELS[value.estimate_source].toLowerCase()}).`
          : 'Not counted in your portfolio value yet. Add your value to include it.'}
      </Text>
      <AppDialog {...dialogProps} />
    </View>
  );
}

function ValueLine({ label, text }: { label: string; text: string }) {
  const { colors, fonts: f } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: 13, fontFamily: f.bold, color: colors.text }}>
        {label}
      </Text>
      <Text style={{ fontSize: 12.5, color: colors.textMuted, lineHeight: 18 }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
});
