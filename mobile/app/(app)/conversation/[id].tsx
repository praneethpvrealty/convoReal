import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MediaImage } from '@/components/media-image';
import { Avatar } from '@/components/ui';
import { ApiError, sendTextMessage } from '@/lib/api';
import { bubbleTime, dayLabel } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';
import type { Conversation, Message, MessageStatus } from '@/lib/types';

const PAGE_SIZE = 60;

type ThreadItem =
  | { kind: 'message'; message: Message }
  | { kind: 'day'; id: string; label: string };

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw error;
  return (data ?? []) as Message[];
}

async function fetchConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Conversation | null;
}

export default function ConversationScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: conversation } = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => fetchConversation(id),
    enabled: Boolean(id),
  });
  const { data: messages, isLoading } = useQuery({
    queryKey: ['messages', id],
    queryFn: () => fetchMessages(id),
    enabled: Boolean(id),
  });

  // Live updates for this thread.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`messages:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['messages', id] });
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  // Opening the thread clears its unread counter (same client-side
  // update the web inbox performs; RLS scopes it to our account).
  useEffect(() => {
    if (!id) return;
    supabase
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('id', id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }));
  }, [id, messages?.length]);

  // Interleave day separators (list is inverted: newest first).
  const items = useMemo<ThreadItem[]>(() => {
    const list = messages ?? [];
    const out: ThreadItem[] = [];
    for (let i = 0; i < list.length; i++) {
      out.push({ kind: 'message', message: list[i] });
      const label = dayLabel(list[i].created_at);
      const nextOlder = list[i + 1];
      if (!nextOlder || dayLabel(nextOlder.created_at) !== label) {
        out.push({ kind: 'day', id: `day-${label}-${i}`, label });
      }
    }
    return out;
  }, [messages]);

  const title = conversation?.contact?.name || conversation?.contact?.phone || 'Conversation';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: () => <ThreadHeader title={title} status={conversation?.status} />,
          headerStyle: { backgroundColor: colors.tabBar },
          headerTintColor: colors.text,
        }}
      />

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(item) => (item.kind === 'message' ? item.message.id : item.id)}
          inverted
          contentContainerStyle={{ padding: spacing.md, gap: 4 }}
          renderItem={({ item }) =>
            item.kind === 'day' ? (
              <DaySeparator label={item.label} />
            ) : (
              <MessageBubble message={item.message} />
            )
          }
        />
      )}

      <Composer conversationId={id} />
    </KeyboardAvoidingView>
  );
}

function ThreadHeader({ title, status }: { title: string; status?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Avatar name={title} size={34} />
      <View>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }} numberOfLines={1}>
          {title}
        </Text>
        {status ? (
          <Text style={{ fontSize: 11.5, color: colors.textMuted, textTransform: 'capitalize' }}>
            {status}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function DaySeparator({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', marginVertical: spacing.sm }}>
      <Text
        style={{
          fontSize: 11.5,
          fontWeight: '600',
          color: colors.textMuted,
          backgroundColor: colors.surface,
          overflow: 'hidden',
          borderRadius: radius.full,
          paddingHorizontal: 12,
          paddingVertical: 4,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function StatusTicks({ status, colors }: { status: MessageStatus; colors: ThemeColors }) {
  if (status === 'failed') {
    return <Ionicons name="alert-circle" size={13} color={colors.danger} />;
  }
  if (status === 'sending') {
    return <Ionicons name="time-outline" size={12} color={colors.outgoingMeta} />;
  }
  const double = status === 'delivered' || status === 'read';
  return (
    <Ionicons
      name={double ? 'checkmark-done' : 'checkmark'}
      size={13}
      color={status === 'read' ? colors.readTick : colors.outgoingMeta}
    />
  );
}

const MEDIA_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  document: 'document-text-outline',
  audio: 'mic-outline',
  video: 'videocam-outline',
  location: 'location-outline',
  template: 'albums-outline',
  interactive: 'return-down-back-outline',
};

function MessageBubble({ message }: { message: Message }) {
  const { colors } = useTheme();
  const outgoing = message.sender_type !== 'customer';
  const isBot = message.sender_type === 'bot';

  return (
    <View
      style={[
        styles.bubble,
        outgoing
          ? { alignSelf: 'flex-end', backgroundColor: colors.outgoingBubble, borderBottomRightRadius: 4 }
          : { alignSelf: 'flex-start', backgroundColor: colors.incomingBubble, borderBottomLeftRadius: 4 },
      ]}
    >
      {isBot ? (
        <Text style={{ fontSize: 10.5, fontWeight: '700', color: colors.outgoingMeta }}>
          🤖 Bot
        </Text>
      ) : null}

      {message.content_type === 'image' && message.media_url ? (
        <MediaImage relativeUrl={message.media_url} />
      ) : null}

      {message.content_type !== 'text' && message.content_type !== 'image' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons
            name={MEDIA_ICONS[message.content_type] ?? 'attach-outline'}
            size={15}
            color={outgoing ? colors.outgoingMeta : colors.textMuted}
          />
          <Text
            style={{
              fontSize: 12.5,
              fontStyle: 'italic',
              color: outgoing ? colors.outgoingMeta : colors.textMuted,
              textTransform: 'capitalize',
            }}
          >
            {message.content_type}
          </Text>
        </View>
      ) : null}

      {message.content_text ? (
        <Text
          style={{
            fontSize: 15,
            lineHeight: 21,
            color: outgoing ? colors.outgoingText : colors.incomingText,
          }}
        >
          {message.content_text}
        </Text>
      ) : null}

      <View style={styles.meta}>
        <Text
          style={{
            fontSize: 10.5,
            color: outgoing ? colors.outgoingMeta : colors.textFaint,
          }}
        >
          {bubbleTime(message.created_at)}
        </Text>
        {outgoing ? <StatusTicks status={message.status} colors={colors} /> : null}
      </View>

      {message.status === 'failed' && message.error_info ? (
        <Text style={{ fontSize: 11.5, color: outgoing ? '#ffd7d7' : colors.danger }}>
          {message.error_info}
        </Text>
      ) : null}
    </View>
  );
}

function Composer({ conversationId }: { conversationId: string }) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendTextMessage(conversationId, text);
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    } catch (err) {
      // Outside WhatsApp's 24h service window the API rejects free-form
      // text — surface its message rather than silently retrying.
      setError(err instanceof ApiError ? err.message : 'Failed to send — try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <View>
      {error ? (
        <View style={[styles.errorBar, { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name="warning-outline" size={14} color={colors.danger} />
          <Text style={{ flex: 1, fontSize: 12.5, color: colors.danger }}>{error}</Text>
          <Pressable onPress={() => setError(null)} hitSlop={8}>
            <Ionicons name="close" size={14} color={colors.danger} />
          </Pressable>
        </View>
      ) : null}
      <View style={[styles.composer, { backgroundColor: colors.tabBar, borderTopColor: colors.border }]}>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
          ]}
          placeholder="Type a message"
          placeholderTextColor={colors.textFaint}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable
          style={[
            styles.sendButton,
            { backgroundColor: colors.primary, opacity: !draft.trim() || sending ? 0.5 : 1 },
          ]}
          onPress={send}
          disabled={!draft.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Ionicons name="send" size={18} color={colors.onPrimary} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '82%',
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 3,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-end',
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
