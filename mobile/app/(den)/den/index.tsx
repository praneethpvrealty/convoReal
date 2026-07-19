import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, FilterChip, Tag } from '@/components/ui';
import { fetchDenBids, fetchDenDashboard, fetchDenMe } from '@/lib/den-api';
import { formatInr } from '@/lib/format';
import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * Owners Den home — the owner's activity overview: interest totals
 * for the window, then every listed property with its per-property
 * stats and the managing agency. Mirrors the web /den dashboard.
 */
export default function DenHomeScreen() {
  const { colors, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<7 | 30>(7);

  const me = useQuery({ queryKey: ['den-me'], queryFn: fetchDenMe });
  const dashboard = useQuery({
    queryKey: ['den-dashboard', days],
    queryFn: () => fetchDenDashboard(days),
  });
  const bids = useQuery({ queryKey: ['den-bids'], queryFn: fetchDenBids });

  const pendingBids = (bids.data?.bids ?? []).filter((b) => b.status === 'pending').length;
  const totals = dashboard.data?.totals;
  const properties = dashboard.data?.properties ?? [];

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.sm }]}
      refreshControl={
        <RefreshControl
          refreshing={dashboard.isFetching}
          onRefresh={() => {
            me.refetch();
            dashboard.refetch();
            bids.refetch();
          }}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 26, fontFamily: f.extrabold, color: colors.text }}>
            Owners Den
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted }} numberOfLines={1}>
            {me.data?.display_name || me.data?.phone || 'Your properties, tracked'}
          </Text>
        </View>
        <Link href="/(den)/den/settings" asChild>
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Den settings"
            style={[styles.iconPill, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
          >
            <Ionicons name="settings-outline" size={19} color={colors.text} />
          </Pressable>
        </Link>
      </View>

      {/* Offers entry */}
      <Link href="/(den)/den/bids" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            pendingBids > 0 ? `${pendingBids} offers awaiting your response` : 'View offers'
          }
          style={StyleSheet.flatten([
            styles.bidsCard,
            { backgroundColor: pendingBids > 0 ? colors.primary : colors.glass,
              borderColor: pendingBids > 0 ? colors.primary : colors.glassBorder },
          ])}
        >
          <Ionicons
            name="pricetags"
            size={20}
            color={pendingBids > 0 ? colors.onPrimary : colors.primary}
          />
          <Text
            style={{
              flex: 1,
              fontSize: 15,
              fontFamily: f.bold,
              color: pendingBids > 0 ? colors.onPrimary : colors.text,
            }}
          >
            {pendingBids > 0
              ? `${pendingBids} offer${pendingBids === 1 ? '' : 's'} awaiting your response`
              : 'Offers on your properties'}
          </Text>
          <Ionicons
            name="chevron-forward"
            size={17}
            color={pendingBids > 0 ? colors.onPrimary : colors.textFaint}
          />
        </Pressable>
      </Link>

      {/* Window toggle + totals */}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <FilterChip label="Last 7 days" active={days === 7} onPress={() => setDays(7)} />
        <FilterChip label="Last 30 days" active={days === 30} onPress={() => setDays(30)} />
      </View>
      <View style={styles.grid}>
        <StatTile icon="eye-outline" label="Showcase views" value={totals?.views} />
        <StatTile icon="chatbubbles-outline" label="Enquiries" value={totals?.inquiries} />
        <StatTile icon="heart-outline" label="Shortlisted" value={totals?.shortlisted} />
        <StatTile icon="walk-outline" label="Site visits" value={totals?.visits} />
      </View>

      {/* Properties */}
      <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: f.bold }]}>
        Your properties
      </Text>
      {dashboard.isLoading ? null : properties.length === 0 ? (
        <EmptyState
          icon="home-outline"
          title="No properties linked yet"
          subtitle="Your agency links listings to you by your WhatsApp number. Ask them to add you as the owner on your property."
        />
      ) : (
        properties.map((p) => (
          <View
            key={`${p.property_id}-${p.agency_name ?? ''}`}
            style={[styles.propCard, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
          >
            {p.cover_image ? (
              <Image source={{ uri: p.cover_image }} style={styles.cover} resizeMode="cover" />
            ) : (
              <View style={[styles.cover, { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="home-outline" size={26} color={colors.primary} />
              </View>
            )}
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontSize: 14.5, fontFamily: f.bold, color: colors.text }} numberOfLines={1}>
                {(p as { title?: string | null }).title || 'Your property'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {p.listing_type ? <Tag label={p.listing_type} /> : null}
                {p.deal_mode && p.deal_mode !== 'off' ? (
                  <Tag label="Deal Mode" color={colors.success} />
                ) : null}
                {p.agency_name ? <Tag label={p.agency_name} /> : null}
              </View>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>
                {[
                  p.price ? formatInr(p.price) : p.rent_per_month ? `${formatInr(p.rent_per_month)}/mo` : null,
                  `${p.views} views`,
                  `${p.inquiries} enquiries`,
                  p.visits ? `${p.visits} visits` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          </View>
        ))
      )}

      <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center', marginTop: spacing.sm }}>
        Deal rooms and Token Safe live on the web Den for now.
      </Text>
    </ScrollView>
  );
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value?: number;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
      <Ionicons name={icon} size={17} color={colors.primary} />
      <Text style={{ fontSize: 20, fontFamily: f.extrabold, color: colors.text }}>
        {value ?? '…'}
      </Text>
      <Text style={{ fontSize: 11.5, color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconPill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bidsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    gap: 3,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  sectionTitle: { fontSize: 17, marginTop: spacing.sm },
  propCard: {
    flexDirection: 'row',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.sm,
    alignItems: 'center',
  },
  cover: { width: 72, height: 72, borderRadius: radius.md },
});
