import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError, sendTextMessage } from '@/lib/api';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import type { Conversation, Message } from '@/lib/types';

const PAGE_SIZE = 50;

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const { data: conversation } = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => fetchConversation(id),
    enabled: Boolean(id),
  });
  const { data: messages } = useQuery({
    queryKey: ['messages', id],
    queryFn: () => fetchMessages(id),
    enabled: Boolean(id),
  });

  // Per-conversation channel (plan: `messages:${conversationId}`) so
  // incoming customer messages appear without a manual refresh.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`messages:${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${id}`,
        },
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

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await sendTextMessage(id, text);
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['messages', id] });
    } catch (err) {
      // WhatsApp rejects free-form sends outside the 24h service window;
      // the API returns the explanation — surface it instead of retrying.
      setSendError(
        err instanceof ApiError ? err.message : 'Failed to send — try again.'
      );
    } finally {
      setSending(false);
    }
  }

  const title =
    conversation?.contact?.name || conversation?.contact?.phone || 'Conversation';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen options={{ title }} />
      <FlatList
        style={styles.list}
        data={messages ?? []}
        keyExtractor={(m) => m.id}
        inverted
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => <MessageBubble message={item} />}
      />
      {sendError ? <Text style={styles.sendError}>{sendError}</Text> : null}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Type a message"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable
          style={[styles.sendButton, (!draft.trim() || sending) && styles.sendDisabled]}
          onPress={send}
          disabled={!draft.trim() || sending}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const outgoing = message.sender_type !== 'customer';
  return (
    <View
      style={[
        styles.bubble,
        outgoing ? styles.bubbleOut : styles.bubbleIn,
      ]}
    >
      {message.content_type === 'text' ? (
        <Text style={outgoing ? styles.textOut : styles.textIn}>
          {message.content_text}
        </Text>
      ) : (
        // Media rendering (auth-gated proxy fetch) lands in Phase 2 —
        // see absoluteMediaUrl()/authHeaders() in lib/api.ts.
        <Text style={[outgoing ? styles.textOut : styles.textIn, styles.mediaStub]}>
          [{message.content_type}]{message.content_text ? ` ${message.content_text}` : ''}
        </Text>
      )}
      <Text style={outgoing ? styles.metaOut : styles.metaIn}>
        {new Date(message.created_at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}
        {outgoing && message.status === 'failed' ? ' · failed' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  listContent: { padding: 12, gap: 6 },
  bubble: {
    maxWidth: '80%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  bubbleIn: { alignSelf: 'flex-start', backgroundColor: colors.incomingBubble },
  bubbleOut: { alignSelf: 'flex-end', backgroundColor: colors.outgoingBubble },
  textIn: { color: colors.text, fontSize: 15 },
  textOut: { color: '#fff', fontSize: 15 },
  mediaStub: { fontStyle: 'italic' },
  metaIn: { color: colors.textMuted, fontSize: 10, alignSelf: 'flex-end' },
  metaOut: { color: '#e6dcfb', fontSize: 10, alignSelf: 'flex-end' },
  sendError: {
    color: colors.danger,
    fontSize: 13,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
    color: colors.text,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
});
