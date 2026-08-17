import { Ionicons } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { AttachmentSheet, type AttachmentChoice } from '@/components/attachment-sheet';
import { ContactPickerSheet } from '@/components/contact-picker-sheet';
import { ContextMenu } from '@/components/context-menu';
import { ConversationMenu } from '@/components/conversation-menu';
import { ConvoRealLoader } from '@/components/loader';
import { MessageBubble, QuotedMessage } from '@/components/message-bubble';
import { PropertyPickerSheet } from '@/components/property-picker-sheet';
import { MoveToEngineSheet } from '@/components/move-to-engine-sheet';
import { TemplatePicker } from '@/components/template-picker';
import { Avatar } from '@/components/ui';
import {
  ApiError,
  forwardMessage,
  reactToMessage,
  sendGroupMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendTextMessage,
  setMessageState,
  suggestReplies,
  uploadChatMedia,
} from '@/lib/api';
import { buildInquiryDraft } from '@/lib/approve-contact';
import {
  attachmentFilename,
  attachmentKind,
  attachmentMimeType,
  formatDuration,
} from '@/lib/attachments';
import { useAuthStore } from '@/lib/auth-store';
import { isReengagementError } from '@/lib/customer-window';
import { needsReply, unanswered, unansweredLabel } from '@/lib/reply-state';
import { haptic } from '@/lib/haptics';
import {
  canForward,
  canResend,
  forwardSummary,
  forwardableText,
  messagePreview,
} from '@/lib/message-actions';
import {
  HIDE_ACTION_LABEL,
  HIDE_CONFIRM_MESSAGE,
  pinAction,
  pinnedMessages,
  visibleMessages,
} from '@/lib/message-state';
import {
  QUICK_EMOJIS,
  canReact,
  myReaction,
  reactionsByMessage,
  toggleEmoji,
} from '@/lib/message-reactions';
import {
  conversationTitle,
  type Contact,
  type MessageTemplate,
  type Conversation,
  type Message,
  type MessageReaction,
} from '@/lib/types';
import { dayLabel } from '@/lib/format';
import { settlePending } from '@/lib/pending-messages';
import { queryClient } from '@/lib/query';
import { useCallLog } from '@/lib/use-call-log';
import { supabase, uniqueChannel } from '@/lib/supabase';
import {
  blurredSurfaceColor,
  glassBlurTint,
  radius,
  spacing,
  useTheme,
} from '@/lib/theme';
import { useHeaderHeight } from '@/lib/use-header-height';

const PAGE_SIZE = 60;

/** How long a jumped-to message stays tinted before settling back. */
const HIGHLIGHT_MS = 1400;

/** Scrolled this far up (the list is inverted) and the jump-to-latest
 *  button appears, as it does in WhatsApp. */
const SCROLL_TO_END_THRESHOLD = 420;

/** Shared empty list, so a bubble nobody reacted to keeps the same prop
 *  identity across renders instead of remounting on a fresh `[]`. */
const EMPTY_REACTIONS: MessageReaction[] = [];

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

/** Every reaction in the thread — one bounded read, split per bubble in
 *  memory rather than a query per message. */
async function fetchReactions(conversationId: string): Promise<MessageReaction[]> {
  const { data, error } = await supabase
    .from('message_reactions')
    .select('*')
    .eq('conversation_id', conversationId);
  if (error) throw error;
  return (data ?? []) as MessageReaction[];
}

async function fetchConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*, contact:contacts(*), group:whatsapp_groups(id, subject, status)')
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
  // Message the thread has just jumped to from a quote, tinted until the
  // eye has had time to find it.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  // Messages handed to the API but not yet echoed back by the DB. They
  // render immediately with an hourglass so a send never looks like it
  // was swallowed while WhatsApp is being called (a ~1s round trip on a
  // good connection, longer on mobile data). Cleared as soon as the
  // real row arrives over realtime — see `outgoingSignature`.
  const [pending, setPending] = useState<Message[]>([]);
  const listRef = useRef<FlatList<ThreadItem>>(null);
  const { show, dialogProps } = useAppDialog();
  const { startCall, callLogProps } = useCallLog();
  const userId = useAuthStore((s) => s.session?.user.id);

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

  const { data: reactions } = useQuery({
    queryKey: ['message-reactions', id],
    queryFn: () => fetchReactions(id),
    enabled: Boolean(id),
  });

  // Live updates for this thread. Reactions ride the same channel: a
  // contact hearting a listing should land as fast as their reply does.
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${id}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ['message-reactions', id] })
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

  // A pending bubble is dropped the moment the thread contains the real
  // message it stands for. Matching on the text rather than an id is
  // deliberate: the row is written server-side by the dispatcher, so the
  // client never learns its id, and two different sends of the same text
  // seconds apart would both be settled by then anyway.
  const settledPending = useMemo(
    () => settlePending(pending, messages ?? []),
    [pending, messages]
  );

  // Interleave day separators (list is inverted: newest first).
  const items = useMemo<ThreadItem[]>(() => {
    const list = visibleMessages([...settledPending, ...(messages ?? [])]);
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
  }, [messages, settledPending]);

  // Quoted parents are resolved from the page already on screen; a reply
  // to something older than the window renders as a plain message rather
  // than costing the thread a second query.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages ?? []) map.set(m.id, m);
    return map;
  }, [messages]);

  const reactionsByMessageId = useMemo(
    () => reactionsByMessage(reactions ?? []),
    [reactions]
  );

  const title = conversationTitle(conversation);
  const contactName = conversation?.contact?.name || undefined;

  // Swipe-to-reply and the quote tap both need the composer's attention,
  // so the reply target is set here and the composer reads it.
  const openReply = useCallback((message: Message) => {
    haptic.tap();
    setReplyTo(message);
  }, []);

  /** Jump to the message a quote points at and tint it, WhatsApp-style.
   *  Only the loaded page is addressable — a quote of something older
   *  than the window has no row to scroll to, so nothing happens. */
  const jumpToMessage = useCallback(
    (messageId: string) => {
      const index = items.findIndex(
        (item) => item.kind === 'message' && item.message.id === messageId
      );
      if (index < 0) return;
      haptic.tap();
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      setHighlightId(messageId);
    },
    [items]
  );

  // The tint clears itself; a second jump to the same message restarts it
  // because the id is cleared in between.
  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

  /** Leave, swap or withdraw the agent's reaction. Optimism would have to
   *  be unwound on every Meta refusal, so this waits for the round trip
   *  and lets realtime paint the pill. */
  const applyReaction = useCallback(
    async (message: Message, emoji: string) => {
      if (!canReact(message)) return;
      const next = toggleEmoji(reactionsByMessageId.get(message.id) ?? [], userId, emoji);
      haptic.tap();
      try {
        await reactToMessage(message.id, next);
        queryClient.invalidateQueries({ queryKey: ['message-reactions', id] });
      } catch (err) {
        haptic.warn();
        show({
          title: 'Could not react',
          message: err instanceof ApiError ? err.message : 'Something went wrong — try again.',
        });
      }
    },
    [reactionsByMessageId, userId, id, show]
  );

  async function copyMessage(message: Message) {
    await Clipboard.setStringAsync(forwardableText(message));
    haptic.success();
  }

  const pinned = useMemo(() => pinnedMessages(messages ?? []), [messages]);

  async function changeState(
    message: Message,
    action: 'pin' | 'unpin' | 'hide' | 'restore'
  ) {
    haptic.tap();
    try {
      await setMessageState(message.id, action);
      queryClient.invalidateQueries({ queryKey: ['messages', id] });
    } catch (err) {
      haptic.warn();
      show({
        title: 'Could not update the message',
        message: err instanceof ApiError ? err.message : 'Something went wrong — try again.',
      });
    }
  }

  /** Hiding is confirmed every time. It reads like WhatsApp's "delete
   *  for everyone" and is nothing like it — the customer keeps their
   *  copy, because the Cloud API has no way to take it back. */
  function confirmHide(message: Message) {
    show({
      title: HIDE_ACTION_LABEL,
      message: HIDE_CONFIRM_MESSAGE,
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: () => {} },
        {
          label: HIDE_ACTION_LABEL,
          variant: 'destructive',
          onPress: () => void changeState(message, 'hide'),
        },
      ],
    });
  }

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
      testID="conversation-screen"
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
              awaiting={Boolean(conversation && needsReply(conversation))}
              silence={conversation ? unanswered(conversation) : null}
              onOpenContact={
                conversation?.contact?.id
                  ? () => router.push(`/(app)/contact/${conversation.contact!.id}`)
                  : undefined
              }
              onCall={
                conversation?.contact?.phone
                  ? () =>
                      startCall({
                        id: conversation.contact!.id,
                        name: conversation.contact!.name,
                        phone: conversation.contact!.phone ?? '',
                      })
                  : undefined
              }
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
        <View style={{ flex: 1 }}>
          {pinned.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pinnedRow}
              style={[styles.pinnedBar, { borderBottomColor: colors.glassBorder }]}
            >
              {pinned.map((message) => (
                <Pressable
                  key={message.id}
                  onPress={() => jumpToMessage(message.id)}
                  onLongPress={() => void changeState(message, 'unpin')}
                  accessibilityRole="button"
                  accessibilityLabel={`Pinned: ${messagePreview(message, 60)}`}
                  accessibilityHint="Tap to jump to it, hold to unpin"
                  style={[
                    styles.pinnedChip,
                    { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                  ]}
                >
                  <Ionicons name="pin" size={13} color={colors.primary} />
                  <Text
                    style={{ flexShrink: 1, fontSize: 12.5, color: colors.text }}
                    numberOfLines={1}
                  >
                    {messagePreview(message, 60)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <FlatList
            ref={listRef}
            style={{ flex: 1 }}
            data={items}
            keyExtractor={(item) => (item.kind === 'message' ? item.message.id : item.id)}
            inverted
            contentContainerStyle={{ padding: spacing.md, gap: 4 }}
            onScroll={(e) =>
              setScrolledUp(e.nativeEvent.contentOffset.y > SCROLL_TO_END_THRESHOLD)
            }
            scrollEventThrottle={64}
            // A quoted message far up the page may not be measured yet:
            // land near it first, then ask again now that the rows in
            // between have real heights.
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              listRef.current?.scrollToOffset({
                offset: index * averageItemLength,
                animated: true,
              });
              setTimeout(
                () => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }),
                180
              );
            }}
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
                  reactions={reactionsByMessageId.get(item.message.id) ?? EMPTY_REACTIONS}
                  currentUserId={userId}
                  highlighted={highlightId === item.message.id}
                  onLongPress={(message, x, y) => {
                    haptic.tap();
                    setActionsFor({ message, x, y });
                  }}
                  onReply={openReply}
                  onToggleReaction={applyReaction}
                  onQuotePress={jumpToMessage}
                />
              )
            }
          />
          {scrolledUp ? (
            <Pressable
              onPress={() => {
                haptic.tap();
                listRef.current?.scrollToOffset({ offset: 0, animated: true });
              }}
              accessibilityRole="button"
              accessibilityLabel="Jump to the latest message"
              style={[
                styles.jumpToEnd,
                { backgroundColor: colors.surfaceWell, borderColor: colors.glassBorder },
              ]}
            >
              <Ionicons name="chevron-down" size={20} color={colors.primary} />
            </Pressable>
          ) : null}
        </View>
      )}

      <Composer
        conversationId={id}
        groupId={conversation?.group?.id}
        contactName={contactName}
        contactPhone={conversation?.contact?.phone || undefined}
        contact={conversation?.contact}
        seedDraft={seedDraft}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        resend={resend}
        onResendHandled={() => setResend(null)}
        onPending={(m) =>
          // Also drops anything the thread has caught up with since the
          // last send, so the list cannot grow for the life of the screen.
          setPending((prev) => [m, ...settlePending(prev, messages ?? [])])
        }
        onPendingSettled={(pendingId, patch) =>
          setPending((prev) =>
            patch === null
              ? prev.filter((m) => m.id !== pendingId)
              : prev.map((m) => (m.id === pendingId ? { ...m, ...patch } : m))
          )
        }
      />

      <ContextMenu
        anchor={actionsFor ? { x: actionsFor.x, y: actionsFor.y } : null}
        onClose={() => setActionsFor(null)}
        reactions={
          actionsFor && canReact(actionsFor.message)
            ? {
                emojis: QUICK_EMOJIS,
                selected: myReaction(
                  reactionsByMessageId.get(actionsFor.message.id) ?? EMPTY_REACTIONS,
                  userId
                ),
                onPick: (emoji) => applyReaction(actionsFor.message, emoji),
              }
            : undefined
        }
        actions={
          actionsFor
            ? [
                {
                  icon: 'return-down-back-outline',
                  label: 'Reply',
                  onPress: () => setReplyTo(actionsFor.message),
                },
                ...(canForward(actionsFor.message)
                  ? [
                      {
                        icon: 'copy-outline' as const,
                        label: 'Copy text',
                        onPress: () => void copyMessage(actionsFor.message),
                      },
                    ]
                  : []),
                {
                  icon: actionsFor.message.pinned_at
                    ? ('pin' as const)
                    : ('pin-outline' as const),
                  label: actionsFor.message.pinned_at ? 'Unpin' : 'Pin',
                  onPress: () =>
                    void changeState(actionsFor.message, pinAction(actionsFor.message)),
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
                {
                  icon: 'trash-outline' as const,
                  label: HIDE_ACTION_LABEL,
                  onPress: () => confirmHide(actionsFor.message),
                },
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
        contactId={conversation?.contact?.id}
        status={conversation?.status}
        isArchived={conversation?.is_archived}
      />
      <AppDialog {...dialogProps} />
      <AppDialog {...callLogProps} />
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
  awaiting,
  silence,
  onCall,
  onOpenContact,
}: {
  title: string;
  status?: string;
  awaiting?: boolean;
  silence?: ReturnType<typeof unanswered>;
  onCall?: () => void;
  /** Tapping the name opens the contact record, as WhatsApp does.
   *  Absent on group threads, where there is no single contact. */
  onOpenContact?: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onOpenContact}
      disabled={!onOpenContact}
      accessibilityRole={onOpenContact ? 'button' : undefined}
      accessibilityLabel={onOpenContact ? `Open ${title}` : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
    >
      <Avatar name={title} size={34} />
      <View style={{ flexShrink: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            style={{ fontSize: 16, fontFamily: f.bold, color: colors.text, flexShrink: 1 }}
            numberOfLines={1}
          >
            {title}
          </Text>
          {onCall ? (
            <Pressable
              hitSlop={10}
              onPress={onCall}
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
              color:
                awaiting || status === 'pending'
                  ? colors.warning
                  : colors.textMuted,
            }}
          >
            {awaiting
              ? 'Needs your reply'
              : silence
                ? unansweredLabel(silence)
                : (STATUS_LABELS[status] ?? status)}
          </Text>
        ) : null}
      </View>
    </Pressable>
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

function Composer({
  conversationId,
  groupId,
  contactName,
  contactPhone,
  contact,
  seedDraft,
  replyTo,
  onClearReply,
  resend,
  onResendHandled,
  onPending,
  onPendingSettled,
}: {
  conversationId: string;
  /** Set when this thread is a group. Group sends take a different
   *  route entirely: no contact to resolve, no 24-hour window. */
  groupId?: string;
  contactName?: string;
  contactPhone?: string;
  /** For the invite out of a closed window — the sheet edits and sends
   *  it, so the whole row is needed, not just the phone. */
  contact?: Contact | null;
  seedDraft?: string;
  /** Message being quoted, or null. Cleared once the reply is sent. */
  replyTo: Message | null;
  onClearReply: () => void;
  /** Message to put back on the wire. Sending lives here so a resend
   *  gets the composer's spinner and its 24-hour-window error bar. */
  resend: Message | null;
  onResendHandled: () => void;
  /** Show this message in the thread straight away, before the API has
   *  answered. The thread owns the list, so the composer hands the
   *  bubble up rather than rendering it itself. */
  onPending: (message: Message) => void;
  /** Merge into a pending bubble — its ticks, or the upload path once
   *  the file is up — or drop it entirely with null. */
  onPendingSettled: (pendingId: string, patch: Partial<Message> | null) => void;
}) {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The text Meta refused under its 24-hour rule. A retry will never
  // work, so the error bar offers the one route that needs no template —
  // and it has to carry the exact message that was blocked.
  const [blockedText, setBlockedText] = useState<string | null>(null);
  // Whether the window is what refused this send. blockedText is only
  // set when there is text to hand to the agent's own WhatsApp — an
  // attachment refusal has none, and still needs the other two routes.
  const [windowBlocked, setWindowBlocked] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attaching, setAttaching] = useState<string | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 400);
  const [recording, setRecording] = useState(false);

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
    // Post the bubble before the network call, carrying the hourglass
    // StatusTicks renders for 'sending'. It becomes a single tick when
    // WhatsApp accepts it, and realtime brings the double tick and the
    // blue read tick as Meta's status webhooks land.
    const pendingId = `pending-${Date.now()}`;
    const optimistic: Message = {
      id: pendingId,
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'text',
      content_text: trimmed,
      status: 'sending',
      created_at: new Date().toISOString(),
      reply_to_message_id: replyToMessageId,
    };
    onPending(optimistic);
    try {
      if (groupId) {
        await sendGroupMessage({
          groupId,
          text: trimmed,
          replyToMessageId,
        });
      } else {
        await sendTextMessage(conversationId, trimmed, replyToMessageId);
      }
      // WhatsApp has it. Hold the bubble at one tick rather than
      // dropping it — the real row lands a beat later over realtime and
      // retires it, and removing it here would blink the message out.
      onPendingSettled(pendingId, { status: 'sent' });
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      return true;
    } catch (err) {
      // The draft is kept and the banner below says what went wrong, so
      // a failed bubble here would just say it twice.
      onPendingSettled(pendingId, null);
      haptic.warn();
      // Outside WhatsApp's 24h service window the API rejects free-form
      // text — surface its message rather than silently retrying.
      const closed = isReengagementError(err instanceof ApiError ? err.message : err);
      // Hold the exact text that was refused: this path also carries the
      // property shortlist sheet's message, which never reaches `draft`.
      setBlockedText(closed && contactPhone ? trimmed : null);
      setWindowBlocked(closed);
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

  /** Upload then send. The two are separate calls so a send refused by
   *  the 24-hour window does not cost the agent the upload as well —
   *  but from here they read as one action, so a failure at either step
   *  surfaces on the same error bar. */
  async function sendAttachment(file: { uri: string; name: string; mimeType: string }) {
    setAttaching('Uploading…');
    setError(null);
    setBlockedText(null);
    // The bubble goes up before the upload starts — that is the slowest
    // part of an attachment send, and it is exactly when an agent needs
    // to see something happened. It carries no media_url yet, so it
    // draws as a file row under the hourglass and no real row can be
    // mistaken for it.
    const pendingId = `pending-${Date.now()}`;
    const caption = draft.trim();
    onPending({
      id: pendingId,
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: attachmentKind(file.mimeType),
      content_text: caption || undefined,
      status: 'sending',
      created_at: new Date().toISOString(),
      reply_to_message_id: replyTo?.id,
    });
    try {
      const media = await uploadChatMedia(file);
      setAttaching('Sending…');
      if (groupId) {
        await sendGroupMessage({
          groupId,
          media,
          caption: draft.trim() || undefined,
          replyToMessageId: replyTo?.id,
        });
      } else {
        await sendMediaMessage({
          conversationId,
          media,
          caption: draft.trim() || undefined,
          replyToMessageId: replyTo?.id,
        });
      }
      // Now the bubble can name the file it stands for, which is what
      // retires it when the real row lands.
      onPendingSettled(pendingId, {
        status: 'sent',
        media_url: media.media_url,
      });
      setDraft('');
      onClearReply();
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    } catch (err) {
      onPendingSettled(pendingId, null);
      haptic.warn();
      const closed = isReengagementError(err instanceof ApiError ? err.message : err);
      setError(
        closed
          ? 'Past the 24-hour window — an attachment needs the contact to write first, or pick a template.'
          : err instanceof ApiError
            ? err.message
            : 'Could not send that attachment — try again.'
      );
    } finally {
      setAttaching(null);
    }
  }

  async function pickAttachment(choice: AttachmentChoice) {
    try {
      if (choice === 'document') {
        const DocumentPicker = await import('expo-document-picker');
        const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];
        const mimeType = attachmentMimeType(asset.mimeType, asset.name);
        if (!mimeType) {
          setError('WhatsApp does not accept that kind of file.');
          return;
        }
        await sendAttachment({
          uri: asset.uri,
          name: attachmentFilename(asset.name, asset.uri, mimeType),
          mimeType,
        });
        return;
      }

      const ImagePicker = await import('expo-image-picker');
      const permission =
        choice === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError(
          choice === 'camera'
            ? 'Camera access is needed to take a photo.'
            : 'Photo access is needed to attach from the gallery.'
        );
        return;
      }
      const result =
        choice === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images', 'videos'],
              quality: 0.7,
            });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mimeType = attachmentMimeType(asset.mimeType, asset.fileName ?? asset.uri);
      if (!mimeType) {
        setError('WhatsApp does not accept that kind of file.');
        return;
      }
      await sendAttachment({
        uri: asset.uri,
        name: attachmentFilename(asset.fileName, asset.uri, mimeType),
        mimeType,
      });
    } catch {
      // A missing native module means this build predates the picker.
      setError('Attachments need the latest ConvoReal build — update the app and try again.');
    }
  }

  async function startRecording() {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        setError('Microphone access is needed to record a voice note.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      haptic.tap();
      setRecording(true);
    } catch {
      setError("Couldn't start the microphone — it may be in use by another app.");
    }
  }

  /** `send: false` discards — a cancelled recording must never reach the
   *  contact, so the file is dropped before any upload is attempted. */
  async function stopRecording(send: boolean) {
    setRecording(false);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!send || !uri) return;
      // Under a second is a mis-tap, not a message.
      if ((recorderState.durationMillis ?? 0) < 1000) {
        setError('That was too short to send — hold the mic a moment longer.');
        return;
      }
      haptic.send();
      await sendAttachment({
        uri,
        name: `voice-${Date.now()}.m4a`,
        mimeType: 'audio/mp4',
      });
    } catch {
      haptic.warn();
      setError('Could not save that recording — try again.');
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
    // A template send is the one an agent is least sure landed: it is
    // reached through a picker that closes on send, so without a bubble
    // the thread looks unchanged.
    const pendingId = `pending-${Date.now()}`;
    onPending({
      id: pendingId,
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'template',
      content_text: renderedText,
      status: 'sending',
      created_at: new Date().toISOString(),
    });
    try {
      await sendTemplateMessage({
        conversationId,
        templateName: template.name,
        templateLanguage: template.language,
        bodyParams,
        renderedText,
      });
      onPendingSettled(pendingId, { status: 'sent' });
      setTemplatesOpen(false);
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    } catch (err) {
      onPendingSettled(pendingId, null);
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
      {contact ? (
        <MoveToEngineSheet
          visible={inviteOpen}
          onClose={() => setInviteOpen(false)}
          contact={contact}
        />
      ) : null}
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
        <View style={[styles.errorBlock, { backgroundColor: colors.dangerSoft }]}>
          <View style={styles.errorBar}>
            <Ionicons name="warning-outline" size={14} color={colors.danger} />
            <Text style={{ flex: 1, fontSize: 12.5, color: colors.danger }}>{error}</Text>
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
          {/* A refused send is a dead end unless the way out is right
              here. Three of them, in the order that costs least: a
              template reaches them on this number and keeps the thread
              in the Engine; the agent's own WhatsApp delivers this
              message now but off the record; the invite fixes the cause
              — the window is shut because they have never written, and
              one reply from them opens it for good. */}
          {windowBlocked ? (
            <View style={styles.errorActions}>
              <Pressable
                onPress={() => {
                  haptic.tap();
                  setTemplatesOpen(true);
                }}
                hitSlop={8}
                style={[styles.errorAction, { borderColor: colors.primary }]}
                accessibilityRole="button"
                accessibilityLabel="Send an approved template instead"
              >
                <Ionicons name="document-text-outline" size={13} color={colors.primary} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.primary }}>
                  Template
                </Text>
              </Pressable>
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
              {contact ? (
                <Pressable
                  onPress={() => {
                    haptic.tap();
                    setInviteOpen(true);
                  }}
                  hitSlop={8}
                  style={[styles.errorAction, { borderColor: colors.textMuted }]}
                  accessibilityRole="button"
                  accessibilityLabel="Invite them to message the Engine number"
                >
                  <Ionicons name="arrow-forward-circle-outline" size={13} color={colors.textMuted} />
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted }}>
                    Invite to Engine
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {attaching ? (
        <View style={[styles.statusBar, { backgroundColor: colors.primarySoft }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={{ flex: 1, fontSize: 12.5, color: colors.primary }}>{attaching}</Text>
        </View>
      ) : null}
      {replyTo ? (
        <View style={styles.replyBar}>
          <QuotedMessage message={replyTo} contactName={contactName} onDismiss={onClearReply} />
        </View>
      ) : null}
      <AttachmentSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPick={pickAttachment}
      />
      {recording ? (
        // Replaces the composer outright while recording: a text field
        // the agent cannot use is only there to be mis-tapped, and the
        // two ways out of a recording should be the only things on screen.
        <View
          style={[
            styles.composer,
            {
              backgroundColor: colors.tabBar,
              borderTopColor: colors.glassBorder,
              paddingBottom: Math.max(insets.bottom, spacing.md),
            },
          ]}
        >
          <Pressable
            onPress={() => {
              haptic.tap();
              void stopRecording(false);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Discard voice note"
            style={[styles.templateButton, { backgroundColor: colors.dangerSoft }]}
          >
            <Ionicons name="trash-outline" size={19} color={colors.danger} />
          </Pressable>
          <View style={styles.recordingBar}>
            <View style={[styles.recordDot, { backgroundColor: colors.danger }]} />
            <Text style={{ fontSize: 14, color: colors.text }}>
              Recording {formatDuration(recorderState.durationMillis)}
            </Text>
          </View>
          <Pressable
            onPress={() => void stopRecording(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Send voice note"
            style={[styles.sendButton, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="send" size={18} color={colors.onPrimary} />
          </Pressable>
        </View>
      ) : null}
      {/* Floating glass composer — real blur (content scrolls behind). */}
      <View
        style={[
          styles.composer,
          {
            backgroundColor: blurredSurfaceColor(colors.tabBar),
            borderTopColor: colors.glassBorder,
            paddingBottom: Math.max(insets.bottom, spacing.md),
          },
          recording && styles.hidden,
        ]}
        pointerEvents={recording ? 'none' : 'auto'}
      >
        <BlurView
          intensity={16}
          tint={glassBlurTint(dark)}
          blurMethod="none"
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          style={[styles.templateButton, { backgroundColor: colors.surface }]}
          onPress={() => {
            haptic.tap();
            setAttachOpen(true);
          }}
          disabled={attaching !== null}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Attach a photo, video or document"
          accessibilityState={{ disabled: attaching !== null }}
        >
          <Ionicons name="attach-outline" size={20} color={colors.primary} />
        </Pressable>
        {/* Groups accept approved templates, but sending one needs a
            group-aware template path that does not exist yet — and the
            1:1 route would fail on the missing contact. Hidden rather
            than offered and broken. */}
        {groupId ? null : (
          <Pressable
            style={[styles.templateButton, { backgroundColor: colors.surface }]}
            onPress={() => setTemplatesOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Send a template message"
          >
            <Ionicons name="albums-outline" size={19} color={colors.primary} />
          </Pressable>
        )}
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
        {/* Mic until there is something to send, as WhatsApp does — the
            two actions share the spot because they are the same intent:
            get this to the contact. */}
        <Pressable
          style={[
            styles.sendButton,
            {
              backgroundColor: colors.primary,
              opacity: sending || attaching !== null ? 0.5 : 1,
            },
          ]}
          onPress={draft.trim() ? send : startRecording}
          disabled={sending || attaching !== null}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={draft.trim() ? 'Send message' : 'Record a voice note'}
          accessibilityState={{ disabled: sending || attaching !== null }}
        >
          {sending || attaching !== null ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Ionicons
              name={draft.trim() ? 'send' : 'mic'}
              size={18}
              color={colors.onPrimary}
            />
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
  pinnedBar: {
    flexGrow: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pinnedRow: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  pinnedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 240,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  jumpToEnd: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  errorBlock: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  recordingBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recordDot: { width: 10, height: 10, borderRadius: 5 },
  hidden: { display: 'none' },
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
