import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ConversationMenu } from '@/components/conversation-menu';
import { ConvoRealLoader } from '@/components/loader';
import { MediaImage } from '@/components/media-image';
import { PropertyPickerSheet } from '@/components/property-picker-sheet';
import { TemplatePicker } from '@/components/template-picker';
import { Avatar } from '@/components/ui';
import { ApiError, sendTemplateMessage, sendTextMessage, suggestReplies } from '@/lib/api';
import { buildInquiryDraft } from '@/lib/approve-contact';
import { haptic } from '@/lib/haptics';
import type { MessageTemplate } from '@/lib/types';
import { bubbleTime, dayLabel } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { supabase, uniqueChannel } from '@/lib/supabase';
import { radius, spacing, useTheme, type ThemeColors , fonts } from '@/lib/theme';
import { useHeaderHeight } from '@/lib/use-header-height';
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
  const { colors, fonts: f } = useTheme();
  // `draftPropertyId` is set when the thread is opened from a contact
  // approval whose 24h window had closed — pre-draft the inquired
  // property's details so the agent can send them in one tap.
  const { id, draftPropertyId } = useLocalSearchParams<{
    id: string;
    draftPropertyId?: string;
  }>();
  const headerHeight = useHeaderHeight();
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: conversation } = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => fetchConversation(id),
    enabled: Boolean(id),
  });

  const { data: draftInquiry } = useQuery({
    queryKey: ['draft-property', draftPropertyId],
    enabled: Boolean(draftPropertyId),
    queryFn: () => buildInquiryDraft(draftPropertyId!),
  });
  const seedDraft = draftInquiry?.message;
  const { data: messages, isLoading } = useQuery({
    queryKey: ['messages', id],
    queryFn: () => fetchMessages(id),
    enabled: Boolean(id),
  });

  // Live updates for this thread.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(uniqueChannel(`messages:${id}`))
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
      style={{ flex: 1 }}
      // Android needs an explicit behavior too: under SDK 57 edge-to-edge
      // the window no longer auto-resizes for the keyboard, so without this
      // the composer sits behind it.
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: () => <ThreadHeader title={title} status={conversation?.status} />,
          headerRight: () => (
            <Pressable
              onPress={() => setMenuOpen(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Manage chat"
              style={{ paddingHorizontal: 4 }}
            >
              <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
            </Pressable>
          ),
        }}
      />

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ConvoRealLoader />
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

      <Composer
        conversationId={id}
        contactName={conversation?.contact?.name || undefined}
        seedDraft={seedDraft}
      />

      <ConversationMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        conversationId={id}
        status={conversation?.status}
        isArchived={conversation?.is_archived}
      />
    </KeyboardAvoidingView>
  );
}

// Conversation status is the inbox queue state ("pending" = the bot
// handed off and no human replied yet) — NOT the contact's review
// status. Spell it out so the two can't be confused.
const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  pending: 'Needs your reply',
  closed: 'Closed',
};

function ThreadHeader({ title, status }: { title: string; status?: string }) {
  const { colors, fonts: f } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Avatar name={title} size={34} />
      <View>
        <Text style={{ fontSize: 16, fontFamily: f.bold, color: colors.text }} numberOfLines={1}>
          {title}
        </Text>
        {status ? (
          <Text
            style={{
              fontSize: 11.5,
              color: status === 'pending' ? colors.warning : colors.textMuted,
            }}
          >
            {STATUS_LABELS[status] ?? status}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function DaySeparator({ label }: { label: string }) {
  const { colors, fonts: f } = useTheme();
  return (
    <View style={{ alignItems: 'center', marginVertical: spacing.sm }}>
      <Text
        style={{
          fontSize: 11.5,
          fontFamily: f.semibold,
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

const AnimatedIonicons = Animated.createAnimatedComponent(Ionicons);

/** WhatsApp-style ticks that MORPH on status change: a small pop as
 *  the tick doubles on delivery, and a colour sweep to blue on read —
 *  instead of an instant icon swap. */
function StatusTicks({ status, colors }: { status: MessageStatus; colors: ThemeColors }) {
  const read = status === 'read';
  const pop = useSharedValue(1);
  const blue = useSharedValue(read ? 1 : 0);
  const prev = useRef(status);

  useEffect(() => {
    if (prev.current !== status) {
      prev.current = status;
      pop.value = withSequence(
        withSpring(1.35, { damping: 14, stiffness: 420 }),
        withSpring(1, { damping: 12, stiffness: 260 })
      );
    }
    blue.value = withTiming(read ? 1 : 0, { duration: 350 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, read]);

  const tickStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
    color: interpolateColor(blue.value, [0, 1], [colors.outgoingMeta, colors.readTick]),
  }));

  if (status === 'failed') {
    return (
      <Ionicons
        name="alert-circle"
        size={13}
        color={colors.danger}
        accessibilityLabel="Failed to send"
      />
    );
  }
  if (status === 'sending') {
    return (
      <Ionicons
        name="time-outline"
        size={12}
        color={colors.outgoingMeta}
        accessibilityLabel="Sending"
      />
    );
  }
  const double = status === 'delivered' || read;
  return (
    <AnimatedIonicons
      name={double ? 'checkmark-done' : 'checkmark'}
      size={13}
      style={tickStyle}
      accessibilityLabel={read ? 'Read' : double ? 'Delivered' : 'Sent'}
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
  const { colors, fonts: f } = useTheme();
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
        <Text style={{ fontSize: 10.5, fontFamily: f.bold, color: colors.outgoingMeta }}>
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
        <Text style={{ fontSize: 11.5, color: outgoing ? colors.dangerSoft : colors.danger }}>
          {message.error_info}
        </Text>
      ) : null}
    </View>
  );
}

function Composer({
  conversationId,
  contactName,
  seedDraft,
}: {
  conversationId: string;
  contactName?: string;
  seedDraft?: string;
}) {
  const { colors, dark, fonts: f } = useTheme();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  // Seed the composer once when arriving from an approval that needs a
  // re-engagement send — never clobber text the agent has typed.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seedDraft && !seededRef.current) {
      seededRef.current = true;
      setDraft((prev) => (prev.trim() ? prev : seedDraft));
    }
  }, [seedDraft]);

  async function loadSuggestions() {
    if (suggesting) return;
    setSuggesting(true);
    setError(null);
    haptic.tap();
    try {
      const { suggestions: next } = await suggestReplies(conversationId);
      if (next.length === 0) {
        setError('No suggestions right now — nothing recent to reply to.');
      }
      setSuggestions(next);
    } catch (err) {
      haptic.warn();
      setError(err instanceof ApiError ? err.message : 'Could not load suggestions.');
    } finally {
      setSuggesting(false);
    }
  }

  function useSuggestion(text: string) {
    haptic.tap();
    setDraft(text);
    setSuggestions([]);
  }

  // Shared send path for the composer draft and the property shortlist
  // sheet. Returns whether it went out so callers can clear/close.
  async function sendText(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed || sending) return false;
    setSending(true);
    setError(null);
    try {
      await sendTextMessage(conversationId, trimmed);
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      return true;
    } catch (err) {
      haptic.warn();
      // Outside WhatsApp's 24h service window the API rejects free-form
      // text — surface its message rather than silently retrying.
      setError(err instanceof ApiError ? err.message : 'Failed to send — try again.');
      return false;
    } finally {
      setSending(false);
    }
  }

  async function send() {
    haptic.send();
    const ok = await sendText(draft);
    if (ok) setDraft('');
  }

  async function sendTemplate(
    template: MessageTemplate,
    bodyParams: string[],
    renderedText: string
  ) {
    if (sending) return;
    setSending(true);
    setError(null);
    haptic.send();
    try {
      await sendTemplateMessage({
        conversationId,
        templateName: template.name,
        templateLanguage: template.language,
        bodyParams,
        renderedText,
      });
      setTemplatesOpen(false);
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send template.');
      setTemplatesOpen(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <View>
      <TemplatePicker
        visible={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onSend={sendTemplate}
        sending={sending}
      />
      <PropertyPickerSheet
        visible={propertiesOpen}
        onClose={() => setPropertiesOpen(false)}
        onSend={sendText}
        sending={sending}
        contactName={contactName}
      />
      {suggestions.length > 0 ? (
        <View style={styles.suggestionRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestionScroll}
            keyboardShouldPersistTaps="handled"
          >
            {suggestions.map((s, i) => (
              <Pressable
                key={`${i}-${s.slice(0, 12)}`}
                style={[styles.suggestionChip, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
                onPress={() => useSuggestion(s)}
                accessibilityRole="button"
                accessibilityLabel={`Use suggested reply: ${s}`}
              >
                <Ionicons name="sparkles" size={12} color={colors.primary} />
                <Text style={{ flexShrink: 1, fontSize: 13, color: colors.text }} numberOfLines={2}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            onPress={() => setSuggestions([])}
            hitSlop={10}
            style={styles.suggestionDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss suggestions"
          >
            <Ionicons name="close" size={14} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.errorBar, { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name="warning-outline" size={14} color={colors.danger} />
          <Text style={{ flex: 1, fontSize: 12.5, color: colors.danger }}>{error}</Text>
          <Pressable
            onPress={() => setError(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Dismiss error"
          >
            <Ionicons name="close" size={14} color={colors.danger} />
          </Pressable>
        </View>
      ) : null}
      {/* Floating glass composer — real blur (content scrolls behind). */}
      <View style={[styles.composer, { backgroundColor: colors.tabBar, borderTopColor: colors.glassBorder }]}>
        <BlurView
          intensity={16}
          tint={dark ? 'dark' : 'light'}
          blurMethod="none"
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          style={[styles.templateButton, { backgroundColor: colors.surface }]}
          onPress={() => setTemplatesOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Send a template message"
        >
          <Ionicons name="albums-outline" size={19} color={colors.primary} />
        </Pressable>
        <Pressable
          style={[styles.templateButton, { backgroundColor: colors.surface }]}
          onPress={() => {
            haptic.tap();
            setPropertiesOpen(true);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Share properties into this chat"
        >
          <Ionicons name="home-outline" size={19} color={colors.primary} />
        </Pressable>
        <Pressable
          style={[styles.templateButton, { backgroundColor: colors.surface, opacity: suggesting ? 0.6 : 1 }]}
          onPress={loadSuggestions}
          disabled={suggesting}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Suggest replies"
          accessibilityState={{ disabled: suggesting }}
        >
          {suggesting ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
          )}
        </Pressable>
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
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !draft.trim() || sending }}
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
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingRight: spacing.sm,
  },
  suggestionScroll: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 260,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  suggestionDismiss: {
    padding: 4,
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
  templateButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
