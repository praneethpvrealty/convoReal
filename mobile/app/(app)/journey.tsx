import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { Avatar, EmptyState } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { buildCheckInMessage } from '@/lib/checkin-message';
import { haptic } from '@/lib/haptics';
import { openContactChat } from '@/lib/open-chat';
import { contactPropertyShareUrl } from '@/lib/showcase-share';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { JourneyItem, JourneyStage } from '@/lib/types';
import { usePullRefresh } from '@/lib/use-pull-refresh';

/**
 * Read-only journey list: each contact with the properties on their
 * journey and the stage each has reached (same rows the web's mind map
 * renders — journey_items joined against journey_stages in memory,
 * exactly like journey-overview.tsx). The interactive canvas stays on
 * the web; advancing/dropping happens there.
 */
export default function JourneyScreen() {
  const { colors, fonts: f } = useTheme();
  const accountId = useAuthStore((s) => s.profile?.account_id);
  const { show, close, dialogProps } = useAppDialog();
  // Optional deep-link filter — e.g. the agent switcher on the contact
  // screen opens this list scoped to one contact.
  const { contactId } = useLocalSearchParams<{ contactId?: string }>();

  const { data: stages } = useQuery({
    queryKey: ['journey-stages'],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('journey_stages')
        .select('id, name, color, position')
        .order('position');
      if (error) throw error;
      return (data ?? []) as JourneyStage[];
    },
  });

  const {
    data: items,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['journey-items'],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('journey_items')
        .select(
          'id, contact_id, property_id, stage_id, status, drop_reason, hidden, updated_at, ' +
            'contact:contacts(id, name, phone), property:properties(id, title, property_code)'
        )
        .eq('account_id', accountId!)
        .eq('hidden', false)
        .order('updated_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as JourneyItem[];
    },
  });
  const pull = usePullRefresh(refetch);

  const stageById = useMemo(
    () => new Map((stages ?? []).map((s) => [s.id, s])),
    [stages]
  );

  const groups = useMemo(() => {
    const byContact = new Map<
      string,
      { contact: JourneyItem['contact']; items: JourneyItem[] }
    >();
    for (const item of items ?? []) {
      if (contactId && item.contact_id !== contactId) continue;
      const key = item.contact_id;
      if (!byContact.has(key)) {
        byContact.set(key, { contact: item.contact, items: [] });
      }
      byContact.get(key)!.items.push(item);
    }
    return Array.from(byContact.values());
  }, [items, contactId]);

  /**
   * The one question a stalled branch is asking — still in play, or
   * park it? Both channels open with it already typed: the Engine
   * inbox thread (business number, logged) or the agent's own
   * WhatsApp. Web parity: the journey item sheet's Contact block.
   */
  async function askCheckIn(item: JourneyItem, stageLabel: string | undefined) {
    const contact = item.contact;
    if (!contact) return;
    haptic.tap();
    const name = contact.name || contact.phone || 'this contact';
    // Best-effort: a link that won't resolve is dropped rather than
    // holding up the nudge.
    const propertyUrl = item.property
      ? await contactPropertyShareUrl(contact, item.property).catch(() => null)
      : null;
    const message = buildCheckInMessage({
      contactName: contact.name,
      propertyTitle: item.property?.title,
      propertyCode: item.property?.property_code,
      stageName: stageLabel,
      propertyUrl,
    });
    show({
      title: `Check in with ${name}`,
      message,
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: 'ConvoReal',
          onPress: async () => {
            close();
            const outcome = await openContactChat(contact, { draftText: message });
            if (!outcome.ok && outcome.error) {
              show({ title: 'Could not open thread', message: outcome.error });
            }
          },
        },
        ...(contact.phone
          ? [
              {
                label: 'WhatsApp',
                variant: 'primary' as const,
                onPress: () => {
                  close();
                  Linking.openURL(
                    `https://wa.me/${contact.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
                  );
                },
              },
            ]
          : []),
      ],
    });
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Journeys',
        }}
      />

      <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
        Where every buyer stands, per property. Tap a property to ask whether
        it's still in play. Advancing, dropping and the full mind-map canvas
        live on the web's Journey page.
      </Text>

      {!isLoading && groups.length === 0 ? (
        <EmptyState
          icon="map-outline"
          title="No journeys yet"
          subtitle={
            contactId
              ? 'No journey items for this contact yet.'
              : 'Journeys are captured automatically when you share properties over WhatsApp.'
          }
        />
      ) : (
        groups.map((group) => {
          const name = group.contact?.name || group.contact?.phone || 'Unknown';
          return (
            <View
              key={group.items[0].id}
              style={[
                styles.card,
                {
                  backgroundColor: colors.glass,
                  borderColor: colors.glassBorder,
                },
              ]}
            >
              <Link
                href={`/(app)/contact/${group.items[0].contact_id}`}
                asChild
              >
                <Pressable style={styles.cardHeader}>
                  <Avatar name={name} size={36} />
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 15.5,
                      fontFamily: f.bold,
                      color: colors.text,
                    }}
                  >
                    {name}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textFaint }}>
                    {group.items.length} propert
                    {group.items.length === 1 ? 'y' : 'ies'}
                  </Text>
                </Pressable>
              </Link>
              {group.items.map((item) => {
                const stage = stageById.get(item.stage_id);
                const dropped = item.status === 'dropped';
                const stageLabel = dropped ? undefined : stage?.name;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => void askCheckIn(item, stageLabel)}
                    disabled={!item.contact}
                    accessibilityRole="button"
                    accessibilityLabel={`Check in about ${item.property?.title ?? 'this property'}`}
                    style={[styles.itemRow, { borderTopColor: colors.border }]}
                  >
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: dropped
                          ? colors.danger
                          : stage?.color || colors.primary,
                      }}
                    />
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 13.5,
                        color: dropped ? colors.textFaint : colors.text,
                        textDecorationLine: dropped ? 'line-through' : 'none',
                      }}
                      numberOfLines={1}
                    >
                      {item.property?.title ?? 'Property'}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11.5,
                        fontFamily: f.bold,
                        color: dropped
                          ? colors.danger
                          : (stage?.color ?? colors.textMuted),
                      }}
                    >
                      {dropped
                        ? item.drop_reason || 'Dropped'
                        : (stage?.name ?? '—')}
                    </Text>
                    {item.contact ? (
                      <Ionicons
                        name="chatbubble-ellipses-outline"
                        size={15}
                        color={colors.textFaint}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })
      )}
      <AppDialog {...dialogProps} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
