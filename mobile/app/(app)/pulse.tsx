import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EnterRow, PressScale } from '@/components/motion';
import { PropertyViewersSheet } from '@/components/property-viewers-sheet';
import {
  Avatar,
  EmptyState,
  FilterChip,
  SectionLabel,
  Tag,
} from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { formatInr } from '@/lib/format';
import {
  fetchPulseFeed,
  fetchPulseStats,
  fetchPulseTopProperties,
  type PulseTopProperty,
} from '@/lib/pulse';
import {
  dedupeConsecutiveEvents,
  formatDwellTime,
  formatTimeAgo,
  type DedupedPulseEvent,
} from '@/lib/pulse-feed';
import { radius, spacing, useTheme } from '@/lib/theme';
import { usePullRefresh } from '@/lib/use-pull-refresh';

/**
 * Web parity: the Showcase Pulse page. Live visitor analytics for the
 * links shared over WhatsApp — opens, property views, gallery swipes,
 * map taps and dwell times. Desktop lays the timeline and the top
 * listings side by side; on a phone they stack, with the timeline as
 * the virtualized list underneath.
 */

type FeedFilter = 'all' | 'property_views' | 'identified';

const FEED_FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All activity' },
  { key: 'property_views', label: 'Property views' },
  { key: 'identified', label: 'Identified' },
];

// Below this share of anonymous events (and this minimum feed size), the
// timeline nudges the agent toward per-contact tracked links instead.
const ANONYMOUS_NUDGE_THRESHOLD = 0.6;
const ANONYMOUS_NUDGE_MIN_EVENTS = 5;

export default function PulseScreen() {
  const { colors, fonts: f } = useTheme();
  const accountId = useAuthStore((s) => s.profile?.account_id);
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [viewersFor, setViewersFor] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const stats = useQuery({
    queryKey: ['pulse-stats'],
    enabled: Boolean(accountId),
    queryFn: () => fetchPulseStats(accountId!),
  });
  const top = useQuery({
    queryKey: ['pulse-top-properties'],
    enabled: Boolean(accountId),
    queryFn: () => fetchPulseTopProperties(accountId!),
  });
  const feed = useQuery({
    queryKey: ['pulse-feed'],
    enabled: Boolean(accountId),
    queryFn: fetchPulseFeed,
  });

  const events = useMemo(() => {
    const rows = (feed.data ?? []).filter((evt) => {
      if (filter === 'identified') return Boolean(evt.contact);
      if (filter === 'property_views') return evt.event_type !== 'open';
      return true;
    });
    return dedupeConsecutiveEvents(rows);
  }, [feed.data, filter]);

  const total = feed.data?.length ?? 0;
  const anonymous = (feed.data ?? []).filter((evt) => !evt.contact).length;
  const showNudge =
    total >= ANONYMOUS_NUDGE_MIN_EVENTS &&
    anonymous / total >= ANONYMOUS_NUDGE_THRESHOLD;

  const pull = usePullRefresh(() =>
    Promise.all([stats.refetch(), top.refetch(), feed.refetch()])
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Showcase Pulse' }} />

      <FlatList
        data={events}
        keyExtractor={(evt) => evt.id}
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
            <Text
              style={{ fontSize: 13, lineHeight: 19, color: colors.textMuted }}
            >
              Live visitor analytics for the showcase links you share over
              WhatsApp — opens, image swipes, map taps and dwell times.
            </Text>

            <View style={styles.grid}>
              <StatCard
                icon="link-outline"
                label="Link opens"
                value={stats.data ? String(stats.data.totalViews) : '…'}
              />
              <StatCard
                icon="phone-portrait-outline"
                label="Unique sessions"
                value={stats.data ? String(stats.data.uniqueSessions) : '…'}
              />
              <StatCard
                icon="time-outline"
                label="Avg dwell"
                value={stats.data ? `${stats.data.avgDwellTimeSec}s` : '…'}
              />
            </View>

            <SectionLabel text="Top listings" />
            {top.isLoading ? null : !top.data || top.data.length === 0 ? (
              <Text
                style={[
                  styles.quiet,
                  { color: colors.textFaint, borderColor: colors.border },
                ]}
              >
                No properties viewed yet.
              </Text>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {top.data.map((p) => (
                  <TopListingCard
                    key={p.propertyId}
                    listing={p}
                    onPress={() =>
                      setViewersFor({ id: p.propertyId, title: p.title })
                    }
                  />
                ))}
              </View>
            )}

            <SectionLabel
              text="Live event timeline"
              style={{ marginTop: spacing.sm }}
            />
            <View style={styles.filters}>
              {FEED_FILTERS.map((opt) => (
                <FilterChip
                  key={opt.key}
                  label={opt.label}
                  active={filter === opt.key}
                  onPress={() => setFilter(opt.key)}
                />
              ))}
            </View>

            {showNudge ? (
              <Pressable
                onPress={() => router.push('/(app)/(tabs)/properties')}
                accessibilityRole="button"
                accessibilityLabel="Share tracked links from Properties"
                style={[
                  styles.nudge,
                  {
                    backgroundColor: colors.primarySoft,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <Ionicons
                  name="person-add-outline"
                  size={17}
                  color={colors.primary}
                />
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12.5,
                    lineHeight: 18,
                    color: colors.text,
                  }}
                >
                  Most of this activity is anonymous. Share a property with{' '}
                  <Text style={{ fontFamily: f.bold }}>
                    Send personally (tracked)
                  </Text>{' '}
                  to see visitors by name here.
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.primary}
                />
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          feed.isLoading ? null : (
            <EmptyState
              icon="pulse-outline"
              title={
                total === 0
                  ? 'No engagement yet'
                  : 'No events match this filter'
              }
              subtitle={
                total === 0
                  ? 'Share a showcase link over WhatsApp and every open, swipe and map tap lands here.'
                  : undefined
              }
            />
          )
        }
        renderItem={({ item, index }) => (
          <EnterRow index={index}>
            <EventRow event={item} />
          </EnterRow>
        )}
      />

      <PropertyViewersSheet
        propertyId={viewersFor?.id ?? null}
        propertyTitle={viewersFor?.title ?? ''}
        onClose={() => setViewersFor(null)}
      />
    </View>
  );
}

function StatCard({
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
    <View
      style={[
        styles.stat,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text
        style={{ fontSize: 21, fontFamily: f.extrabold, color: colors.text }}
      >
        {value}
      </Text>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

function TopListingCard({
  listing,
  onPress,
}: {
  listing: PulseTopProperty;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`See viewers of ${listing.title}`}
      contentStyle={[
        styles.listing,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <View style={styles.listingHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{ fontSize: 14.5, fontFamily: f.bold, color: colors.text }}
            numberOfLines={1}
          >
            {listing.title}
          </Text>
          <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
            {listing.propertyCode ?? 'No code'}
          </Text>
        </View>
        <Text
          style={{ fontSize: 14, fontFamily: f.semibold, color: colors.text }}
        >
          {formatInr(listing.price)}
        </Text>
      </View>
      <View style={[styles.listingFoot, { borderTopColor: colors.border }]}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>
          {listing.uniqueViewsCount} unique visitor
          {listing.uniqueViewsCount === 1 ? '' : 's'} · {listing.viewsCount}{' '}
          view{listing.viewsCount === 1 ? '' : 's'}
        </Text>
        <Text
          style={{ fontSize: 12, fontFamily: f.bold, color: colors.primary }}
        >
          See viewers
        </Text>
      </View>
    </PressScale>
  );
}

function EventRow({ event }: { event: DedupedPulseEvent }) {
  const { colors, fonts: f } = useTheme();
  const who =
    event.contact?.name ||
    event.contact?.phone ||
    (event.share
      ? `Guest · via link shared ${formatTimeAgo(event.share.created_at)}`
      : 'Anonymous guest');
  const what = event.property?.title ?? 'a property';
  const dwell =
    event.event_type === 'view_property'
      ? formatDwellTime(event.metadata.duration_ms)
      : '';

  const { icon, tint, action } = describe(event.event_type, colors);

  return (
    <View
      style={[
        styles.event,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <Avatar name={who} size={38} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.eventHead}>
          <Text
            style={{
              fontSize: 14,
              fontFamily: f.semibold,
              color: colors.text,
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {who}
          </Text>
          {event.contact?.name_tag ? (
            <Tag label={event.contact.name_tag} />
          ) : null}
        </View>
        <View style={styles.eventLine}>
          <Ionicons name={icon} size={13} color={tint} />
          <Text
            style={{
              flex: 1,
              fontSize: 12.5,
              lineHeight: 17,
              color: colors.textMuted,
            }}
          >
            {action}
            {event.event_type === 'open' ? '' : ` ${what}`}
            {dwell ? ` · ${dwell}` : ''}
          </Text>
        </View>
        <Text style={{ fontSize: 11, color: colors.textFaint }}>
          {formatTimeAgo(event.created_at)} · {event.session_key.slice(0, 8)}
          {event.repeatCount > 1 ? ` · ×${event.repeatCount}` : ''}
        </Text>
      </View>
    </View>
  );
}

function describe(
  type: DedupedPulseEvent['event_type'],
  colors: ReturnType<typeof useTheme>['colors']
): {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
  action: string;
} {
  switch (type) {
    case 'open':
      return {
        icon: 'open-outline',
        tint: colors.primary,
        action: 'Opened the showcase catalog',
      };
    case 'view_property':
      return { icon: 'eye-outline', tint: colors.success, action: 'Viewed' };
    case 'gallery':
      return {
        icon: 'images-outline',
        tint: colors.mintText,
        action: 'Opened the photo gallery for',
      };
    case 'map_click':
      return {
        icon: 'location-outline',
        tint: colors.warning,
        action: 'Tapped the map pin for',
      };
    default:
      return {
        icon: 'hand-left-outline',
        tint: colors.textMuted,
        action: 'Interacted with',
      };
  }
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: '30%',
    gap: 4,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  quiet: {
    fontSize: 12.5,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  listing: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  listingHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  listingFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  event: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  eventHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eventLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
});
