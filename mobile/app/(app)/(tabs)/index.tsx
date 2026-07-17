import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useEffect } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuthStore } from '@/lib/auth-store';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import type { Conversation } from '@/lib/types';

async function fetchConversations(): Promise<Conversation[]> {
  // Same query the web inbox runs (conversation-list.tsx); RLS scopes
  // it to the caller's account.
  const { data, error } = await supabase
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('is_archived', false)
    .order('last_message_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

export default function InboxScreen() {
  const accountId = useAuthStore((s) => s.profile?.account_id);
  const userId = useAuthStore((s) => s.session?.user.id);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
  });

  // Account-scoped, user-specific channel name per the mobile plan —
  // avoids cross-tenant noise and same-channel collisions.
  useEffect(() => {
    if (!accountId || !userId) return;
    const channel = supabase
      .channel(`conversations:${accountId}:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, userId]);

  return (
    <FlatList
      style={styles.list}
      data={data ?? []}
      keyExtractor={(c) => c.id}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} />
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          {isFetching ? 'Loading conversations…' : 'No conversations yet.'}
        </Text>
      }
      renderItem={({ item }) => <ConversationRow conversation={item} />}
    />
  );
}

function ConversationRow({ conversation }: { conversation: Conversation }) {
  const name =
    conversation.contact?.name || conversation.contact?.phone || 'Unknown';
  const time = conversation.last_message_at
    ? new Date(conversation.last_message_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <Link href={`/(app)/conversation/${conversation.id}`} asChild>
      <Pressable style={styles.row}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.time}>{time}</Text>
          </View>
          <View style={styles.rowTop}>
            <Text style={styles.preview} numberOfLines={1}>
              {conversation.last_message_text ?? ''}
            </Text>
            {conversation.unread_count > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{conversation.unread_count}</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.incomingBubble,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontWeight: '700', fontSize: 18 },
  rowBody: { flex: 1, gap: 2 },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  time: { fontSize: 12, color: colors.textMuted },
  preview: { flex: 1, fontSize: 14, color: colors.textMuted },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
