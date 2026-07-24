import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, Stack, router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EnterRow, PressScale } from '@/components/motion';
import { NotificationBell } from '@/components/notification-bell';
import {
  Avatar,
  ConversationSkeleton,
  EmptyState,
  FilterChip,
  SearchBar,
  Tag,
  UnreadBadge,
  listCard,
} from '@/components/ui';
import { TAB_BAR_CLEARANCE } from '@/app/(app)/(tabs)/_layout';
import { useAuthStore } from '@/lib/auth-store';
import { setConversationArchived } from '@/lib/conversation-actions';
import { haptic } from '@/lib/haptics';
import type { Contact } from '@/lib/types';
import { chatListTime } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { supabase, uniqueChannel } from '@/lib/supabase';
import { radius, spacing, useTheme , fonts, type ThemeColors } from '@/lib/theme';
import type { Conversation, MessageStatus, SenderType } from '@/lib/types';
import { useCredits } from '@/lib/use-credits';

const FILTERS = ['All', 'Unread', 'Open', 'Pending', 'Closed', 'Archived'] as const;
type Filter = (typeof FILTERS)[number];

async function fetchConversations(archived: boolean): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('is_archived', archived)
    // A conversation row can exist with no messages yet (e.g. an approve
    // flow opened it but the send was blocked by the 24-hour window) —
    // those have nothing to show, so keep them out of the inbox.
    .not('last_message_at', 'is', null)
    .order('last_message_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

export default function InboxScreen() {
  const { colors, fonts: f } = useTheme();
  const accountId = useAuthStore((s) => s.profile?.account_id);
  const userId = useAuthStore((s) => s.session?.user.id);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const archived = filter === 'Archived';

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['conversations', archived],
    queryFn: () => fetchConversations(archived),
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
    else if (filter !== 'All' && filter !== 'Archived')
      list = list.filter((c) => c.status === filter.toLowerCase());
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
    <View style={{ flex: 1 }}>
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
              <ConversationRow conversation={item} archived={archived} />
            </EnterRow>
          )}
        />
      )}
    </View>
  );
}

/** Instagram-style ring strip of HOT leads — tap to open the contact. */
function HotLeadsStrip() {
  const { colors, fonts: f } = useTheme();
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
                style={{ fontSize: 11, fontFamily: f.semibold, color: colors.textMuted }}
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
  const { colors, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
  const credits = useCredits();
  const session = useAuthStore((s) => s.session);
  const firstName = (session?.user.email?.split('@')[0] ?? 'there').split(/[._-]/)[0];
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  return (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top + spacing.sm },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}>
          <Avatar name={displayName} size={42} />
          <View>
            <Text style={[styles.headerTitle, { color: colors.text, fontFamily: f.extrabold }]}>Hi, {displayName}</Text>
            <Text style={{ fontSize: 12.5, fontFamily: f.medium, color: colors.textMuted }}>
              Your WhatsApp inbox
            </Text>
          </View>
        </View>
        <NotificationBell />
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
              fontFamily: f.bold,
              color: credits.total === 0 ? colors.danger : colors.mintText,
            }}
          >
            {credits.isLoading ? '…' : `${credits.total}`}
          </Text>
        </View>
      </View>
      <SearchBar
        value={search}
        onChangeText={onSearch}
        placeholder="Search name, phone or message"
      />
    </View>
  );
}

/** WhatsApp-style delivery ticks for the last outgoing message. */
function MessageTicks({ status, colors }: { status: MessageStatus; colors: ThemeColors }) {
  if (status === 'sending') {
    return <Ionicons name="time-outline" size={14} color={colors.textFaint} style={styles.tick} />;
  }
  if (status === 'failed') {
    return <Ionicons name="alert-circle" size={14} color={colors.danger} style={styles.tick} />;
  }
  const read = status === 'read';
  const double = read || status === 'delivered';
  return (
    <Ionicons
      name={double ? 'checkmark-done' : 'checkmark'}
      size={15}
      color={read ? colors.readTick : colors.textFaint}
      style={styles.tick}
    />
  );
}

function ConversationRow({
  conversation,
  archived,
}: {
  conversation: Conversation;
  archived: boolean;
}) {
  const { colors, fonts: f } = useTheme();
  const name = conversation.contact?.name || conversation.contact?.phone || 'Unknown';
  const unread = conversation.unread_count > 0;
  const swipeRef = useRef<Swipeable>(null);

  // Delivery ticks for the last message, WhatsApp-style — only when we
  // sent it. Keyed on last_message_at so a new message refreshes it; the
  // conversations row carries no status, so the latest message's meta is
  // fetched per visible row (FlatList only mounts what's on screen).
  const { data: lastMsg } = useQuery({
    queryKey: ['last-msg-status', conversation.id, conversation.last_message_at],
    enabled: Boolean(conversation.last_message_at),
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('messages')
        .select('sender_type, status')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data ?? null) as { sender_type: SenderType; status: MessageStatus } | null;
    },
  });
  const outgoingTicks =
    lastMsg && lastMsg.sender_type !== 'customer' ? lastMsg.status : null;

  async function toggleArchive() {
    haptic.tap();
    swipeRef.current?.close();
    try {
      await setConversationArchived(conversation.id, !archived);
    } catch (e) {
      haptic.warn();
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Please try again.');
    }
  }

  return (
    <Swipeable
      ref={swipeRef}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          onPress={toggleArchive}
          accessibilityRole="button"
          accessibilityLabel={archived ? 'Unarchive conversation' : 'Archive conversation'}
          style={[
            styles.swipeAction,
            { backgroundColor: archived ? colors.primary : colors.warning },
          ]}
        >
          <Ionicons name={archived ? 'arrow-undo' : 'archive'} size={20} color="#fff" />
          <Text style={styles.swipeActionText}>{archived ? 'Unarchive' : 'Archive'}</Text>
        </Pressable>
      )}
    >
      {/* PressScale + router.push instead of Link asChild: gives iOS
          press feedback (scale) and avoids the Slot flat-style rule. */}
      <PressScale
        onPress={() => router.push(`/(app)/conversation/${conversation.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Open conversation with ${name}`}
        contentStyle={StyleSheet.flatten([
          listCard,
          { backgroundColor: colors.glass, borderColor: colors.glassBorder },
        ])}
      >
        <Avatar name={name} size={50} />
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <View style={styles.nameWrap}>
              <Text
                style={[styles.name, { color: colors.text, fontFamily: f.extrabold }]}
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
            <View style={styles.previewWrap}>
              {outgoingTicks ? <MessageTicks status={outgoingTicks} colors={colors} /> : null}
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
            </View>
            <UnreadBadge count={conversation.unread_count} />
          </View>
        </View>
      </PressScale>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
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
  filtersRow: { height: 52, justifyContent: 'center' },
  filters: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
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
  previewWrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  tick: { marginRight: 3 },
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    width: 96,
    marginRight: spacing.lg,
    marginBottom: spacing.md - 2,
    borderRadius: radius.lg,
  },
  swipeActionText: { color: '#fff', fontSize: 12, fontFamily: fonts.bold },
});
