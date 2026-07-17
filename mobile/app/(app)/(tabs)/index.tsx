import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  Avatar,
  ConversationSkeleton,
  EmptyState,
  FilterChip,
  Tag,
  UnreadBadge,
} from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { chatListTime } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Conversation } from '@/lib/types';
import { useCredits } from '@/lib/use-credits';

const FILTERS = ['All', 'Unread', 'Open', 'Pending', 'Closed'] as const;
type Filter = (typeof FILTERS)[number];

async function fetchConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('is_archived', false)
    .order('last_message_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

export default function InboxScreen() {
  const { colors } = useTheme();
  const accountId = useAuthStore((s) => s.profile?.account_id);
  const userId = useAuthStore((s) => s.session?.user.id);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('All');

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
  });

  useEffect(() => {
    if (!accountId || !userId) return;
    const channel = supabase
      .channel(`conversations:${accountId}:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => queryClient.invalidateQueries({ queryKey: ['conversations'] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, userId]);

  const filtered = useMemo(() => {
    let list = data ?? [];
    if (filter === 'Unread') list = list.filter((c) => c.unread_count > 0);
    else if (filter !== 'All') list = list.filter((c) => c.status === filter.toLowerCase());
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.contact?.name?.toLowerCase().includes(q) ||
          c.contact?.phone?.includes(q) ||
          c.last_message_text?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [data, filter, search]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <InboxHeader search={search} onSearch={setSearch} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.filters}
      >
        {FILTERS.map((f) => (
          <FilterChip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
        ))}
      </ScrollView>

      {isLoading ? (
        <View>
          {Array.from({ length: 8 }, (_, i) => (
            <ConversationSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          refreshControl={
            <RefreshControl
              refreshing={isFetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            search || filter !== 'All' ? (
              <EmptyState
                icon="search-outline"
                title="No matches"
                subtitle="Try a different search or filter."
              />
            ) : (
              <EmptyState
                icon="chatbubbles-outline"
                title="No conversations yet"
                subtitle="Incoming WhatsApp messages to your business number will appear here in real time."
              />
            )
          }
          renderItem={({ item }) => <ConversationRow conversation={item} />}
        />
      )}
    </View>
  );
}

function InboxHeader({
  search,
  onSearch,
}: {
  search: string;
  onSearch: (v: string) => void;
}) {
  const { colors } = useTheme();
  const credits = useCredits();
  return (
    <View style={[styles.header, { backgroundColor: colors.background }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Inbox</Text>
        <View
          style={[
            styles.creditsChip,
            {
              backgroundColor: credits.total === 0 ? colors.dangerSoft : colors.primarySoft,
            },
          ]}
        >
          <Ionicons
            name={credits.total === 0 ? 'lock-closed' : 'flash'}
            size={13}
            color={credits.total === 0 ? colors.danger : colors.primary}
          />
          <Text
            style={{
              fontSize: 12.5,
              fontWeight: '700',
              color: credits.total === 0 ? colors.danger : colors.primary,
            }}
          >
            {credits.isLoading ? '…' : `${credits.total} credits`}
          </Text>
        </View>
      </View>
      <View
        style={[
          styles.search,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Ionicons name="search" size={16} color={colors.textFaint} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search name, phone or message"
          placeholderTextColor={colors.textFaint}
          value={search}
          onChangeText={onSearch}
        />
        {search ? (
          <Pressable onPress={() => onSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ConversationRow({ conversation }: { conversation: Conversation }) {
  const { colors } = useTheme();
  const name = conversation.contact?.name || conversation.contact?.phone || 'Unknown';
  const unread = conversation.unread_count > 0;

  return (
    <Link href={`/(app)/conversation/${conversation.id}`} asChild>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          { borderBottomColor: colors.border },
          pressed && { backgroundColor: colors.surface },
        ]}
      >
        <Avatar name={name} />
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <View style={styles.nameWrap}>
              <Text
                style={[styles.name, { color: colors.text }]}
                numberOfLines={1}
              >
                {name}
              </Text>
              {conversation.contact?.name_tag ? (
                <Tag label={conversation.contact.name_tag} />
              ) : null}
            </View>
            <Text
              style={{
                fontSize: 12,
                fontWeight: unread ? '700' : '400',
                color: unread ? colors.primary : colors.textFaint,
              }}
            >
              {chatListTime(conversation.last_message_at)}
            </Text>
          </View>
          <View style={styles.rowTop}>
            <Text
              style={{
                flex: 1,
                fontSize: 14,
                color: unread ? colors.text : colors.textMuted,
                fontWeight: unread ? '600' : '400',
              }}
              numberOfLines={1}
            >
              {conversation.last_message_text ?? ''}
            </Text>
            <UnreadBadge count={conversation.unread_count} />
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: 54, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  creditsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 14.5 },
  filters: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, gap: 3 },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
});
