import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState, PrimaryButton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { fetchDenBids, respondToBid, type DenBid } from '@/lib/den-api';
import { friendlyError } from '@/lib/errors';
import { chatListTime } from '@/lib/format';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';

function statusColor(status: string, colors: ThemeColors): string {
  switch (status) {
    case 'accepted':
      return colors.success;
    case 'rejected':
    case 'expired':
      return colors.danger;
    case 'countered':
      return colors.warning;
    default:
      return colors.textMuted;
  }
}

/**
 * The owner's offer inbox — every bid across all linked agencies.
 * Bidders stay masked as agency cards until a bid is accepted; on
 * accept the contact is revealed mutually (same rules as the web).
 */
export default function DenBidsScreen() {
  const { colors, fonts: f } = useTheme();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['den-bids'],
    queryFn: fetchDenBids,
  });

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) =>
      respondToBid(id, action),
    onSuccess: () => {
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['den-bids'] });
    },
    onError: (e) => {
      haptic.warn();
      Alert.alert(
        'Could not respond',
        friendlyError(e instanceof ApiError ? e.message : 'Try again.')
      );
    },
  });

  function confirm(bid: DenBid, action: 'accept' | 'reject') {
    Alert.alert(
      action === 'accept' ? 'Accept this offer?' : 'Decline this offer?',
      action === 'accept'
        ? `Accepting reveals your contact details to ${bid.bidder_agency} and opens a deal room. This resolves all other offers on the property.`
        : 'The bidder is notified that you declined.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action === 'accept' ? 'Accept' : 'Decline',
          style: action === 'reject' ? 'destructive' : 'default',
          onPress: () => respond.mutate({ id: bid.id, action }),
        },
      ]
    );
  }

  const bids = data?.bids ?? [];

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
      }
    >
      {isLoading ? null : bids.length === 0 ? (
        <EmptyState
          icon="pricetags-outline"
          title="No offers yet"
          subtitle="When an agency's buyer places an offer on one of your properties, it lands here for you to accept or decline."
        />
      ) : (
        bids.map((bid) => {
          const actionable = bid.status === 'pending';
          return (
            <View
              key={bid.id}
              style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
            >
              <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                {bid.property_image ? (
                  <Image source={{ uri: bid.property_image }} style={styles.cover} resizeMode="cover" />
                ) : (
                  <View
                    style={[
                      styles.cover,
                      { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
                    ]}
                  >
                    <Ionicons name="home-outline" size={20} color={colors.primary} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 14.5, fontFamily: f.bold, color: colors.text }} numberOfLines={1}>
                    {bid.property_title}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
                    {bid.bidder_agency} · {chatListTime(bid.created_at)}
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: f.bold,
                    textTransform: 'uppercase',
                    color: statusColor(bid.status, colors),
                  }}
                >
                  {bid.status}
                </Text>
              </View>

              <Text style={{ fontSize: 22, fontFamily: f.extrabold, color: colors.primary }}>
                {bid.amount ? formatInr(bid.amount) : '—'}
                {bid.bid_type ? (
                  <Text style={{ fontSize: 12.5, fontFamily: f.medium, color: colors.textMuted }}>
                    {'  '}
                    {bid.bid_type}
                  </Text>
                ) : null}
              </Text>
              {bid.message ? (
                <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textMuted }}>
                  “{bid.message}”
                </Text>
              ) : null}

              {bid.counter_amount ? (
                <Text style={{ fontSize: 12.5, color: colors.warning }}>
                  Countered at {formatInr(bid.counter_amount)}
                  {bid.counter_message ? ` — ${bid.counter_message}` : ''}
                </Text>
              ) : null}

              {actionable ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      label="Accept"
                      busy={respond.isPending && respond.variables?.id === bid.id && respond.variables.action === 'accept'}
                      disabled={respond.isPending}
                      onPress={() => confirm(bid, 'accept')}
                    />
                  </View>
                  <Pressable
                    onPress={() => confirm(bid, 'reject')}
                    disabled={respond.isPending}
                    accessibilityRole="button"
                    accessibilityLabel="Decline offer"
                    style={[styles.declineButton, { borderColor: colors.danger, opacity: respond.isPending ? 0.5 : 1 }]}
                  >
                    <Text style={{ fontSize: 14.5, fontFamily: f.bold, color: colors.danger }}>
                      Decline
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {bid.status === 'accepted' && bid.bidder_contact ? (
                <View
                  style={[styles.revealRow, { backgroundColor: colors.successSoft, borderColor: colors.success }]}
                >
                  <Ionicons name="person-circle-outline" size={20} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13.5, fontFamily: f.bold, color: colors.text }}>
                      {bid.bidder_contact.name || 'Buyer contact'}
                    </Text>
                    {bid.bidder_contact.phone ? (
                      <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                        {bid.bidder_contact.phone}
                      </Text>
                    ) : null}
                  </View>
                  {bid.bidder_contact.phone ? (
                    <Pressable
                      onPress={() =>
                        Linking.openURL(`https://wa.me/${bid.bidder_contact!.phone!.replace(/\D/g, '')}`)
                      }
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="WhatsApp the buyer"
                    >
                      <Ionicons name="logo-whatsapp" size={22} color={colors.success} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {bid.deal_room_id ? (
                <Text style={{ fontSize: 12, color: colors.textFaint }}>
                  Deal room open — continue on the web Den for Token Safe.
                </Text>
              ) : null}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cover: { width: 48, height: 48, borderRadius: radius.sm },
  declineButton: {
    borderWidth: 1.5,
    borderRadius: radius.full,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  revealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
});
