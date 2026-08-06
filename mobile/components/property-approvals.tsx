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
  const { show, close, dialogProps } = useAppDialog();
  const inFlight = useRef<Map<string, 'approve' | 'reject'>>(new Map());
  const [deciding, setDeciding] = useState<Map<string, 'approve' | 'reject'>>(
    new Map()
  );

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

  function begin(id: string, verdict: 'approve' | 'reject') {
    inFlight.current.set(id, verdict);
    setDeciding(new Map(inFlight.current));
  }

  function end(id: string) {
    inFlight.current.delete(id);
    setDeciding(new Map(inFlight.current));
  }

  async function approve(property: Property) {
    // Only the same listing twice is refused — deciding the next one
    // while this is publishing is the point.
    if (inFlight.current.has(property.id)) return;
    haptic.tap();
    begin(property.id, 'approve');

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
      end(property.id);
    }
  }

  /** Rejecting hides the listing from the inventory and can't be undone
   *  from here, so unlike approve it asks first — a mis-tap on a phone is
   *  a different risk from a mis-click on a desktop list. */
  function confirmReject(property: Property) {
    if (inFlight.current.has(property.id)) return;
    haptic.tap();
    show({
      title: 'Reject this listing?',
      message: `"${property.title}" stays on record but won't be published or shared. The owner is not notified.`,
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: 'Reject',
          variant: 'destructive',
          onPress: () => {
            close();
            void reject(property);
          },
        },
      ],
    });
  }

  async function reject(property: Property) {
    begin(property.id, 'reject');
    try {
      await apiFetch(`/api/properties/${property.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'Rejected' }),
      });
      haptic.success();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [PENDING_PROPERTIES_QUERY_KEY],
        }),
        queryClient.invalidateQueries({ queryKey: ['properties'] }),
      ]);
    } catch (err) {
      haptic.warn();
      show({
        title: 'Rejection failed',
        message: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      end(property.id);
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
            const verdict = deciding.get(property.id);
            const approving = verdict === 'approve';
            const rejecting = verdict === 'reject';
            const busy = verdict !== undefined;
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
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={
                      approving
                        ? `${property.title} approved, publishing`
                        : `Approve listing ${property.title}`
                    }
                    accessibilityState={{ disabled: busy, busy: approving }}
                    style={({ pressed }) => [
                      styles.button,
                      {
                        backgroundColor: approving
                          ? colors.success
                          : colors.primary,
                        opacity: rejecting ? 0.4 : pressed && !busy ? 0.8 : 1,
                      },
                    ]}
                  >
                    {approving ? (
                      <Animated.View entering={FadeIn.duration(180)}>
                        <Ionicons
                          name="checkmark-circle"
                          size={15}
                          color={colors.onSuccess}
                        />
                      </Animated.View>
                    ) : (
                      <Ionicons name="checkmark" size={15} color={colors.onPrimary} />
                    )}
                    <Text
                      style={[
                        styles.buttonText,
                        {
                          fontFamily: f.bold,
                          color: approving ? colors.onSuccess : colors.onPrimary,
                        },
                      ]}
                    >
                      {approving ? 'Publishing…' : 'Approve'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmReject(property)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={
                      rejecting
                        ? `Rejecting ${property.title}`
                        : `Reject listing ${property.title}`
                    }
                    accessibilityState={{ disabled: busy, busy: rejecting }}
                    style={({ pressed }) => [
                      styles.button,
                      styles.rejectButton,
                      {
                        borderColor: colors.danger,
                        opacity: approving ? 0.4 : pressed && !busy ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={rejecting ? 'close-circle' : 'close'}
                      size={15}
                      color={colors.danger}
                    />
                    <Text
                      style={[
                        styles.buttonText,
                        { fontFamily: f.bold, color: colors.danger },
                      ]}
                    >
                      {rejecting ? 'Rejecting…' : 'Reject'}
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
  rejectButton: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: { fontSize: 13 },
});
