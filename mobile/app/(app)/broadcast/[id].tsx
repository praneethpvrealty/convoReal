import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ConvoRealLoader } from '@/components/loader';
import { Avatar, FilterChip } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme, type ThemeColors , fonts } from '@/lib/theme';
import type { Broadcast, BroadcastRecipient } from '@/lib/types';

const STATUS_FILTERS = ['All', 'Read', 'Delivered', 'Sent', 'Replied', 'Failed', 'Pending'] as const;

function recipientColor(status: BroadcastRecipient['status'], colors: ThemeColors): string {
  switch (status) {
    case 'read':
    case 'replied':
      return colors.success;
    case 'failed':
    case 'rate_limited':
      return colors.danger;
    case 'pending':
      return colors.textFaint;
    default:
      return colors.textMuted;
  }
}

export default function BroadcastDetailScreen() {
  const { colors, fonts: f } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>('All');

  const { data: broadcast } = useQuery({
    queryKey: ['broadcast', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('broadcasts')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as Broadcast;
    },
  });

  const { data: recipients, isLoading } = useQuery({
    queryKey: ['broadcast-recipients', id],
    enabled: Boolean(id),
    queryFn: async () => {
      // Same detail query as the web (broadcasts/[id]/page.tsx).
      const { data, error } = await supabase
        .from('broadcast_recipients')
        .select('*, contact:contacts(id, name, phone)')
        .eq('broadcast_id', id)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as BroadcastRecipient[];
    },
  });

  const filtered = (recipients ?? []).filter((r) =>
    filter === 'All' ? true : r.status === filter.toLowerCase()
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: broadcast?.name ?? 'Broadcast',
        }}
      />

      <View style={styles.filtersRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {STATUS_FILTERS.map((f) => (
            <FilterChip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <ConvoRealLoader style={{ alignSelf: 'center', marginTop: 40 }} />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={filtered}
          keyExtractor={(r) => r.id}
          ListEmptyComponent={
            <Text style={{ textAlign: 'center', marginTop: 40, color: colors.textMuted }}>
              No recipients with this status.
            </Text>
          }
          renderItem={({ item }) => {
            const name = item.contact?.name || item.contact?.phone || 'Removed contact';
            return (
              <View style={[styles.row, { borderBottomColor: colors.border }]}>
                <Avatar name={name} size={38} />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={{ fontSize: 14.5, fontFamily: f.semibold, color: colors.text }}>
                    {name}
                  </Text>
                  {item.error_message ? (
                    <Text style={{ fontSize: 12, color: colors.danger }} numberOfLines={1}>
                      {item.error_message}
                    </Text>
                  ) : null}
                </View>
                <Text
                  style={{
                    fontSize: 11.5,
                    fontFamily: f.bold,
                    textTransform: 'uppercase',
                    color: recipientColor(item.status, colors),
                  }}
                >
                  {item.status}
                </Text>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filtersRow: { height: 52, justifyContent: 'center' },
  filters: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
