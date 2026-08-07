import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Linking from 'expo-linking';
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

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { ContactPickerSheet } from '@/components/contact-picker-sheet';
import { ContextMenu } from '@/components/context-menu';
import { ConversationMenu } from '@/components/conversation-menu';
import { ConvoRealLoader } from '@/components/loader';
import { MediaImage } from '@/components/media-image';
import { PropertyPickerSheet } from '@/components/property-picker-sheet';
import { TemplatePicker } from '@/components/template-picker';
import { Avatar } from '@/components/ui';
import {
  ApiError,
  forwardMessage,
  sendTemplateMessage,
  sendTextMessage,
  suggestReplies,
} from '@/lib/api';
import { buildInquiryDraft } from '@/lib/approve-contact';
import { isReengagementError } from '@/lib/customer-window';
import { haptic } from '@/lib/haptics';
import {
  canForward,
  canResend,
  forwardSummary,
  forwardableText,
  messageAuthorLabel,
  messagePreview,
} from '@/lib/message-actions';
import type { Contact, MessageTemplate , Conversation, Message, MessageStatus } from '@/lib/types';
import { bubbleTime, dayLabel } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { supabase, uniqueChannel } from '@/lib/supabase';
import { radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';
import { useHeaderHeight } from '@/lib/use-header-height';

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
  // `draftPropertyId` is set when the thread is opened from a contact
  // approval whose 24h window had closed — pre-draft the inquired
  // property's details so the agent can send them in one tap.
  const { id, draftPropertyId, draftText } = useLocalSearchParams<{
    id: string;
    draftPropertyId?: string;
    /** Plain-text composer seed (e.g. a showcase share drafted from the
     *  contact picker) — draftPropertyId wins when both are present. */
    draftText?: string;
  }>();
  const headerHeight = useHeaderHeight();
  const [menuOpen, setMenuOpen] = useState(false);
  // Long-press target, with the press point the floating menu anchors to.
  const [actionsFor, setActionsFor] = useState<{ message: Message; x: number; y: number } | null>(
    null
  );
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [resend, setResend] = useState<Message | null>(null);
  const [forwardFor, setForwardFor] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState(false);
  const { show, dialogProps } = useAppDialog();

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
  const seedDraft = draftInquiry?.message ?? (draftText?.trim() ? draftText : undefined);
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
      // Read-receipt bookkeeping on open; the thread renders from
      // messages either way and the next query reconciles the badge.
      // eslint-disable-next-line convoreal/supabase-write-guard
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

  // Quoted parents are resolved from the page already on screen; a reply
  // to something older than the window renders as a plain message rather
  // than costing the thread a second query.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages ?? []) map.set(m.id, m);
    return map;
  }, [messages]);

  const title = conversation?.contact?.name || conversation?.contact?.phone || 'Conversation';
  const contactName = conversation?.contact?.name || undefined;

  async function forwardTo(contacts: Contact[]) {
    const message = forwardFor;
    if (!message || contacts.length === 0) return;
    setForwarding(true);
    haptic.send();
    try {
      const { data } = await forwardMessage(
        message.id,
        contacts.map((c) => c.id)
      );
      const summary = forwardSummary(data.results);
      setForwardFor(null);
      if (summary) {
        haptic.warn();
        show(summary);
      } else {
        haptic.success();
      }
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      haptic.warn();
      setForwardFor(null);
      show({
        title: 'Could not forward',
        message: err instanceof ApiError ? err.message : 'Something went wrong — try again.',
      });
    } finally {
      setForwarding(false);
    }
  }

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
          headerTitle: () => (
            <ThreadHeader
              title={title}
              status={conversation?.status}
              phone={conversation?.contact?.phone || undefined}
            />
          ),
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
              <MessageBubble
                message={item.message}
                parent={
                  item.message.reply_to_message_id
                    ? messagesById.get(item.message.reply_to_message_id)
                    : undefined
                }
                contactName={contactName}
                onLongPress={(message, x, y) => {
                  haptic.tap();
                  setActionsFor({ message, x, y });
                }}
              />
            )
          }
        />
      )}

      <Composer
        conversationId={id}
        contactName={contactName}
        contactPhone={conversation?.contact?.phone || undefined}
        seedDraft={seedDraft}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        resend={resend}
        onResendHandled={() => setResend(null)}
      />

      <ContextMenu
        anchor={actionsFor ? { x: actionsFor.x, y: actionsFor.y } : null}
        onClose={() => setActionsFor(null)}
        actions={
          actionsFor
            ? [
                {
                  icon: 'return-down-back-outline',
                  label: 'Reply',
                  onPress: () => setReplyTo(actionsFor.message),
                },
                ...(canResend(actionsFor.message)
                  ? [
                      {
                        icon: 'refresh-outline' as const,
                        label: 'Send again',
                        onPress: () => setResend(actionsFor.message),
                      },
                    ]
                  : []),
                ...(canForward(actionsFor.message)
                  ? [
                      {
                        icon: 'arrow-redo-outline' as const,
                        label: 'Forward',
                        onPress: () => setForwardFor(actionsFor.message),
                      },
                    ]
                  : []),
              ]
            : []
        }
      />

      <ContactPickerSheet
        visible={forwardFor !== null}
        onClose={() => setForwardFor(null)}
        multiSelect
        confirmLabel="Forward"
        onSelectMany={forwardTo}
        title="Forward to"
        hint="Pick who should receive this message from your business number. It lands in their own chat thread — a contact who hasn’t written in 24 hours needs a template instead."
        busy={forwarding}
        busyLabel="Forwarding…"
      />

      <ConversationMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        conversationId={id}
        status={conversation?.status}
        isArchived={conversation?.is_archived}
      />
      <AppDialog {...dialogProps} />
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

function ThreadHeader({
  title,
  status,
  phone,
}: {
  title: string;
  status?: string;
  phone?: string;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Avatar name={title} size={34} />
      <View style={{ flexShrink: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            style={{ fontSize: 16, fontFamily: f.bold, color: colors.text, flexShrink: 1 }}
            numberOfLines={1}
          >
            {title}
          </Text>
          {phone ? (
            <Pressable
              hitSlop={10}
              onPress={() => {
                haptic.tap();
                Linking.openURL(`tel:${phone}`);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Call ${title}`}
              style={[styles.headerCall, { backgroundColor: colors.primarySoft }]}
            >
              <Ionicons name="call" size={13} color={colors.primary} />
            </Pressable>
          ) : null}
        </View>
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

/** The quoted parent, rendered inside a reply's own bubble and above the
 *  composer while a reply is being written. */
function QuotedMessage({
  message,
  contactName,
  onDismiss,
}: {
  message: Message;
  contactName?: string;
  onDismiss?: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View style={[styles.quote, { borderLeftColor: colors.primary, backgroundColor: colors.glass }]}>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 11, fontFamily: f.bold, color: colors.primary }} numberOfLines={1}>
          {messageAuthorLabel(message, contactName)}
        </Text>
        <Text style={{ fontSize: 12.5, color: colors.textMuted }} numberOfLines={2}>
          {messagePreview(message)}
        </Text>
      </View>
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Cancel reply"
        >
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function MessageBubble({
  message,
  parent,
  contactName,
  onLongPress,
}: {
  message: Message;
  parent?: Message;
  contactName?: string;
  onLongPress: (message: Message, x: number, y: number) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const outgoing = message.sender_type !== 'customer';
  const isBot = message.sender_type === 'bot';

  return (
    <Pressable
      onLongPress={(e) => onLongPress(message, e.nativeEvent.pageX, e.nativeEvent.pageY)}
      accessibilityHint="Hold for reply, send again and forward"
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

      {parent ? <QuotedMessage message={parent} contactName={contactName} /> : null}

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
    </Pressable>
  );
}

function Composer({
  conversationId,
  contactName,
  contactPhone,
  seedDraft,
  replyTo,
  onClearReply,
  resend,
  onResendHandled,
}: {
  conversationId: string;
  contactName?: string;
  contactPhone?: string;
  seedDraft?: string;
  /** Message being quoted, or null. Cleared once the reply is sent. */
  replyTo: Message | null;
  onClearReply: () => void;
  /** Message to put back on the wire. Sending lives here so a resend
   *  gets the composer's spinner and its 24-hour-window error bar. */
  resend: Message | null;
  onResendHandled: () => void;
}) {
  const { colors, dark } = useTheme();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The text Meta refused under its 24-hour rule. A retry will never
  // work, so the error bar offers the one route that needs no template —
  // and it has to carry the exact message that was blocked.
  const [blockedText, setBlockedText] = useState<string | null>(null);
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

  function applySuggestion(text: string) {
    haptic.tap();
    setDraft(text);
    setSuggestions([]);
  }

  // Shared send path for the composer draft, the property shortlist
  // sheet and a resend. Returns whether it went out so callers can
  // clear/close.
  async function sendText(text: string, replyToMessageId?: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed || sending) return false;
    setSending(true);
    setError(null);
    setBlockedText(null);
    try {
      await sendTextMessage(conversationId, trimmed, replyToMessageId);
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      return true;
    } catch (err) {
      haptic.warn();
      // Outside WhatsApp's 24h service window the API rejects free-form
      // text — surface its message rather than silently retrying.
      const closed = isReengagementError(err instanceof ApiError ? err.message : err);
      // Hold the exact text that was refused: this path also carries the
      // property shortlist sheet's message, which never reaches `draft`.
      setBlockedText(closed && contactPhone ? trimmed : null);
      setError(
        closed
          ? contactPhone
            ? 'Past the 24-hour window — send it from your own WhatsApp, or pick a template.'
            : 'Past the 24-hour window — pick a template to re-engage.'
          : err instanceof ApiError
            ? err.message
            : 'Failed to send — try again.'
      );
      return false;
    } finally {
      setSending(false);
    }
  }

  /** Hands the composed text to the agent's own WhatsApp: no template,
   *  no window, and the line breaks survive. It leaves from a personal
   *  number, so the Engine never records it — the draft stays put so
   *  nothing is lost if the agent backs out. */
  function sendFromOwnWhatsApp() {
    if (!blockedText || !contactPhone) return;
    haptic.tap();
    void Linking.openURL(
      `https://wa.me/${contactPhone.replace(/\D/g, '')}?text=${encodeURIComponent(blockedText)}`
    );
  }

  async function send() {
    haptic.send();
    const ok = await sendText(draft, replyTo?.id);
    if (ok) {
      setDraft('');
      onClearReply();
    }
  }

  // A resend is the same send, with the original text. Guarded by id so
  // a re-render never fires it twice; the tap is reported back either
  // way, so tapping the same message again resends it again.
  const resentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!resend || resentRef.current === resend.id) return;
    resentRef.current = resend.id;
    void (async () => {
      haptic.send();
      await sendText(forwardableText(resend));
      resentRef.current = null;
      onResendHandled();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resend]);

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
            keyboardDismissMode="on-drag"
          >
            {suggestions.map((s, i) => (
              <Pressable
                key={`${i}-${s.slice(0, 12)}`}
                style={[styles.suggestionChip, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
                onPress={() => applySuggestion(s)}
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
          {blockedText ? (
            <Pressable
              onPress={sendFromOwnWhatsApp}
              hitSlop={8}
              style={[styles.errorAction, { borderColor: colors.success }]}
              accessibilityRole="button"
              accessibilityLabel="Send this message from your own WhatsApp"
            >
              <Ionicons name="logo-whatsapp" size={13} color={colors.success} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.success }}>
                My WhatsApp
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              setError(null);
              setBlockedText(null);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Dismiss error"
          >
            <Ionicons name="close" size={14} color={colors.danger} />
          </Pressable>
        </View>
      ) : null}
      {replyTo ? (
        <View style={styles.replyBar}>
          <QuotedMessage message={replyTo} contactName={contactName} onDismiss={onClearReply} />
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
  headerCall: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  quote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderLeftWidth: 2,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 2,
  },
  replyBar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  errorAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 8,
    paddingVertical: 4,
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
