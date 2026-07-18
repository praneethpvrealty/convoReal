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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EnterRow } from '@/components/motion';
import {
  Avatar,
  ConversationSkeleton,
  EmptyState,
  FilterChip,
  Tag,
  UnreadBadge,
} from '@/components/ui';
import { TAB_BAR_CLEARANCE } from '@/app/(app)/(tabs)/_layout';
import { useAuthStore } from '@/lib/auth-store';
import type { Contact } from '@/lib/types';
import { chatListTime } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { supabase, uniqueChannel } from '@/lib/supabase';
import { radius, shadows, spacing, useTheme , fonts } from '@/lib/theme';
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
      .channel(uniqueChannel(`conversations:${accountId}:${userId}`))
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

      <HotLeadsStrip />

      <View style={styles.filtersRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {FILTERS.map((f) => (
            <FilterChip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <View>
          {Array.from({ length: 8 }, (_, i) => (
            <ConversationSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingTop: spacing.xs, paddingBottom: TAB_BAR_CLEARANCE }}
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
          renderItem={({ item, index }) => (
            <EnterRow index={index}>
              <ConversationRow conversation={item} />
            </EnterRow>
          )}
        />
      )}
    </View>
  );
}

/** Instagram-style ring strip of HOT leads — tap to open the contact. */
function HotLeadsStrip() {
  const { colors } = useTheme();
  const { data } = useQuery({
    queryKey: ['hot-leads'],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .eq('lead_temp', 'HOT')
        .order('updated_at', { ascending: false })
        .limit(12);
      if (error) throw error;
      return (rows ?? []) as Contact[];
    },
  });

  if (!data?.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, marginTop: spacing.sm }}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
    >
      {data.map((c) => {
        const name = c.name || c.phone;
        return (
          <Link key={c.id} href={`/(app)/contact/${c.id}`} asChild>
            <Pressable style={{ alignItems: 'center', gap: 4, width: 62 }}>
              <Avatar name={name} size={50} ring />
              <Text
                style={{ fontSize: 11, fontFamily: fonts.semibold, color: colors.textMuted }}
                numberOfLines={1}
              >
                {name.split(/\s+/)[0]}
              </Text>
            </Pressable>
          </Link>
        );
      })}
    </ScrollView>
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
  const insets = useSafeAreaInsets();
  const credits = useCredits();
  const session = useAuthStore((s) => s.session);
  const firstName = (session?.user.email?.split('@')[0] ?? 'there').split(/[._-]/)[0];
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  return (
    <View
      style={[
        styles.header,
        { backgroundColor: colors.background, paddingTop: insets.top + spacing.sm },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}>
          <Avatar name={displayName} size={42} />
          <View>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Hi, {displayName}</Text>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.medium, color: colors.textMuted }}>
              Your WhatsApp inbox
            </Text>
          </View>
        </View>
        <View
          style={[
            styles.creditsChip,
            {
              backgroundColor: credits.total === 0 ? colors.dangerSoft : colors.mint,
            },
          ]}
        >
          <Ionicons
            name={credits.total === 0 ? 'lock-closed' : 'flash'}
            size={13}
            color={credits.total === 0 ? colors.danger : colors.mintText}
          />
          <Text
            style={{
              fontSize: 12.5,
              fontFamily: fonts.bold,
              color: credits.total === 0 ? colors.danger : colors.mintText,
            }}
          >
            {credits.isLoading ? '…' : `${credits.total}`}
          </Text>
        </View>
      </View>
      <View
        style={[
          styles.search,
          shadows.soft,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
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
      {/* expo-router's <Slot> child needs ONE flat style object — no
          arrays, no style functions (both break under Link asChild). */}
      <Pressable
        style={StyleSheet.flatten([
          styles.row,
          shadows.card,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
        ])}
        android_ripple={{ color: colors.background }}
      >
        <Avatar name={name} size={50} />
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
                fontFamily: unread ? fonts.bold : fonts.medium,
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
                fontFamily: unread ? fonts.bold : fonts.medium,
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
  header: { paddingHorizontal: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 23, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  creditsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    // Keep clear of Expo Go's floating dev-menu bubble in the corner.
    marginRight: spacing.sm,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 14.5, fontFamily: fonts.medium },
  filtersRow: { height: 52, justifyContent: 'center' },
  filters: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md - 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 16.5, fontFamily: fonts.extrabold, letterSpacing: -0.2, flexShrink: 1 },
});
