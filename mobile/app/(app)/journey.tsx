import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Avatar, EmptyState } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme , fonts } from '@/lib/theme';
import type { JourneyItem, JourneyStage } from '@/lib/types';

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

  const { data: items, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['journey-items'],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('journey_items')
        .select(
          'id, contact_id, property_id, stage_id, status, drop_reason, hidden, updated_at, ' +
            'contact:contacts(id, name, phone), property:properties(id, title)'
        )
        .eq('account_id', accountId!)
        .eq('hidden', false)
        .order('updated_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as JourneyItem[];
    },
  });

  const stageById = useMemo(
    () => new Map((stages ?? []).map((s) => [s.id, s])),
    [stages]
  );

  const groups = useMemo(() => {
    const byContact = new Map<string, { contact: JourneyItem['contact']; items: JourneyItem[] }>();
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

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
      }
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Journeys',
        }}
      />

      <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
        Where every buyer stands, per property. Advancing, dropping and the full mind-map canvas
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
              style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
            >
              <Link href={`/(app)/contact/${group.items[0].contact_id}`} asChild>
                <Pressable style={styles.cardHeader}>
                  <Avatar name={name} size={36} />
                  <Text style={{ flex: 1, fontSize: 15.5, fontFamily: f.bold, color: colors.text }}>
                    {name}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textFaint }}>
                    {group.items.length} propert{group.items.length === 1 ? 'y' : 'ies'}
                  </Text>
                </Pressable>
              </Link>
              {group.items.map((item) => {
                const stage = stageById.get(item.stage_id);
                const dropped = item.status === 'dropped';
                return (
                  <View key={item.id} style={[styles.itemRow, { borderTopColor: colors.border }]}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: dropped ? colors.danger : stage?.color || colors.primary,
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
                        color: dropped ? colors.danger : (stage?.color ?? colors.textMuted),
                      }}
                    >
                      {dropped ? (item.drop_reason || 'Dropped') : (stage?.name ?? '—')}
                    </Text>
                  </View>
                );
              })}
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
