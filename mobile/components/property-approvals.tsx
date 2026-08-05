import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { SectionLabel } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Property } from '@/lib/types';

export const PENDING_PROPERTIES_QUERY_KEY = 'pending-properties';

interface PendingResponse {
  data: Property[];
}

/**
 * Listings submitted over WhatsApp land as "Pending Review" and stay
 * invisible until someone approves them — until now only possible from
 * the web inventory. Approving publishes the listing, syncs it to the
 * Meta catalog and notifies the owner, so it is several seconds of work:
 * the row goes green on tap and finishes in the background, and the next
 * listing stays tappable rather than waiting its turn.
 *
 * Renders nothing when the account has no listing waiting — same as the
 * location approvals panel it sits beside.
 */
export function PropertyApprovals({ style }: { style?: ViewStyle } = {}) {
  const { colors, fonts: f } = useTheme();
  const { show, dialogProps } = useAppDialog();
  const inFlight = useRef<Set<string>>(new Set());
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: [PENDING_PROPERTIES_QUERY_KEY],
    staleTime: 30_000,
    queryFn: () =>
      apiFetch<PendingResponse>(
        `/api/properties?${new URLSearchParams({
          status: 'Pending Review',
          page: '0',
          limit: '10',
        }).toString()}`
      ),
  });

  const rows = data?.data ?? [];

  async function approve(property: Property) {
    // Only the same listing twice is refused — approving the next one
    // while this is publishing is the point.
    if (inFlight.current.has(property.id)) return;
    haptic.tap();
    inFlight.current.add(property.id);
    setApprovingIds(new Set(inFlight.current));

    try {
      const result = await apiFetch<{
        notificationSent: boolean;
        ownerName: string | null;
      }>(`/api/properties/${property.id}/approve`, { method: 'POST' });
      haptic.success();
      if (result.notificationSent && result.ownerName) {
        show({
          title: 'Listing approved',
          message: `${property.title} is live. ${result.ownerName} has been notified on WhatsApp.`,
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [PENDING_PROPERTIES_QUERY_KEY],
        }),
        queryClient.invalidateQueries({ queryKey: ['properties'] }),
      ]);
    } catch (err) {
      haptic.warn();
      show({
        title: 'Approval failed',
        message: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      inFlight.current.delete(property.id);
      setApprovingIds(new Set(inFlight.current));
    }
  }

  // The dialog lives outside the list so approving the LAST pending
  // listing — which empties this panel — doesn't unmount the message
  // confirming it.
  return (
    <>
      {rows.length > 0 ? (
        <View style={[{ gap: spacing.sm }, style]}>
          <SectionLabel text={`Listings to review (${rows.length})`} />
          {rows.map((property) => {
            const approving = approvingIds.has(property.id);
            const price =
              property.listing_type === 'Rent'
                ? property.rent_per_month
                  ? `${formatInr(property.rent_per_month)}/mo`
                  : null
                : property.price
                  ? formatInr(property.price)
                  : null;
            const place = [property.sublocality, property.city]
              .filter(Boolean)
              .join(', ');

            return (
              <View
                key={property.id}
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.glass,
                    borderColor: colors.glassBorder,
                  },
                ]}
              >
                <View style={styles.head}>
                  <Ionicons
                    name="home-outline"
                    size={17}
                    color={colors.warning}
                  />
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 14,
                      fontFamily: f.bold,
                      color: colors.text,
                    }}
                    numberOfLines={1}
                  >
                    {property.title}
                  </Text>
                  {price ? (
                    <Text
                      style={{
                        fontSize: 12.5,
                        fontFamily: f.bold,
                        color: colors.primary,
                      }}
                    >
                      {price}
                    </Text>
                  ) : null}
                </View>
                {place ? (
                  <Text
                    style={{ fontSize: 12.5, color: colors.textMuted }}
                    numberOfLines={1}
                  >
                    {place}
                  </Text>
                ) : null}
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => approve(property)}
                    disabled={approving}
                    accessibilityRole="button"
                    accessibilityLabel={
                      approving
                        ? `${property.title} approved, publishing`
                        : `Approve listing ${property.title}`
                    }
                    accessibilityState={{
                      disabled: approving,
                      busy: approving,
                    }}
                    style={({ pressed }) => [
                      styles.button,
                      {
                        backgroundColor: approving
                          ? colors.success
                          : colors.primary,
                        opacity: pressed && !approving ? 0.8 : 1,
                      },
                    ]}
                  >
                    {approving ? (
                      <Animated.View entering={FadeIn.duration(180)}>
                        <Ionicons
                          name="checkmark-circle"
                          size={15}
                          color="#fff"
                        />
                      </Animated.View>
                    ) : (
                      <Ionicons name="checkmark" size={15} color="#fff" />
                    )}
                    <Text style={[styles.buttonText, { fontFamily: f.bold }]}>
                      {approving ? 'Publishing…' : 'Approve'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      <AppDialog {...dialogProps} />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  buttonText: { fontSize: 13, color: '#fff' },
});
