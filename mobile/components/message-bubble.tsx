import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { AudioBubble } from '@/components/audio-bubble';
import { MediaImage } from '@/components/media-image';
import { authHeaders } from '@/lib/api';
import { bubbleTime } from '@/lib/format';
import { mediaSource } from '@/lib/media-source';
import { haptic } from '@/lib/haptics';
import { messageAuthorLabel, messagePreview } from '@/lib/message-actions';
import {
  DOUBLE_TAP_EMOJI,
  canReact,
  groupReactions,
} from '@/lib/message-reactions';
import { replyDragOffset, replyProgress, shouldTriggerReply } from '@/lib/swipe-reply';
import { radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';
import type { Message, MessageReaction, MessageStatus } from '@/lib/types';

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

/** Content types with no renderer of their own — they still say what
 *  they are rather than showing an empty bubble. */
const UNRENDERED_TYPES = ['location', 'template', 'interactive'];

/** True while an outgoing attachment is still being uploaded: the
 *  bubble is on screen (so the send is visibly happening) but there is
 *  no stored path to render from yet. */
function isUploading(message: Message): boolean {
  return (
    message.status === 'sending' &&
    !message.media_url &&
    ['image', 'video', 'audio', 'document'].includes(message.content_type)
  );
}

/**
 * A video or document: an openable row rather than an inline player.
 * A video decoded in every bubble would cost a scrolling thread far
 * more than it gives, and a document has nothing to show inline — both
 * hand off to the OS, which already knows how to display them.
 */
function MediaAttachment({ message, outgoing }: { message: Message; outgoing: boolean }) {
  const { colors, fonts: f } = useTheme();
  const [opening, setOpening] = useState(false);
  const isVideo = message.content_type === 'video';
  const meta = outgoing ? colors.outgoingMeta : colors.textMuted;

  async function open() {
    if (!message.media_url || opening) return;
    const source = mediaSource(message.media_url);
    if (!source) return;
    setOpening(true);
    haptic.tap();
    try {
      // The proxy is auth-gated, so a browser handoff would 401. Its
      // one-time Meta URL is fetched here and opened instead.
      if (source.kind === 'proxy') {
        const response = await fetch(source.uri, { headers: await authHeaders() });
        if (!response.ok) throw new Error('unavailable');
        await Linking.openURL(response.url || source.uri);
      } else {
        await Linking.openURL(source.uri);
      }
    } catch {
      haptic.warn();
    } finally {
      setOpening(false);
    }
  }

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={isVideo ? 'Open video' : `Open ${message.content_text || 'document'}`}
      style={styles.attachment}
    >
      {opening ? (
        <ActivityIndicator size="small" color={meta} />
      ) : (
        <Ionicons
          name={isVideo ? 'play-circle-outline' : 'document-text-outline'}
          size={26}
          color={outgoing ? colors.outgoingText : colors.primary}
        />
      )}
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          style={{
            fontSize: 13.5,
            fontFamily: f.semibold,
            color: outgoing ? colors.outgoingText : colors.incomingText,
          }}
          numberOfLines={1}
        >
          {isVideo ? 'Video' : 'Document'}
        </Text>
        <Text style={{ fontSize: 11, color: meta }}>Tap to open</Text>
      </View>
    </Pressable>
  );
}

/** The quoted parent, rendered inside a reply's own bubble and above the
 *  composer while a reply is being written. Tapping it in the thread jumps
 *  to the message it quotes, as WhatsApp does. */
export function QuotedMessage({
  message,
  contactName,
  onDismiss,
  onPress,
}: {
  message: Message;
  contactName?: string;
  onDismiss?: () => void;
  onPress?: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? 'Go to the quoted message' : undefined}
      style={[styles.quote, { borderLeftColor: colors.primary, backgroundColor: colors.glass }]}
    >
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
    </Pressable>
  );
}

/**
 * One message in the thread, with the WhatsApp gesture set: swipe right
 * to quote it, double-tap to heart it, hold for the full menu. The
 * gestures are accelerators only — everything they do is also reachable
 * from that menu, which is what a screen reader gets.
 */
export function MessageBubble({
  message,
  parent,
  contactName,
  reactions,
  currentUserId,
  highlighted,
  onLongPress,
  onReply,
  onToggleReaction,
  onQuotePress,
}: {
  message: Message;
  parent?: Message;
  contactName?: string;
  reactions: MessageReaction[];
  currentUserId?: string | null;
  /** Briefly tinted after the thread jumped here from a quote. */
  highlighted?: boolean;
  onLongPress: (message: Message, x: number, y: number) => void;
  onReply: (message: Message) => void;
  onToggleReaction: (message: Message, emoji: string) => void;
  onQuotePress: (messageId: string) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const outgoing = message.sender_type !== 'customer';
  const isBot = message.sender_type === 'bot';
  const reactable = canReact(message);
  const groups = groupReactions(reactions, currentUserId);

  const drag = useSharedValue(0);
  // Tracks whether the pull has passed the trigger point, so the "this
  // will reply" haptic fires once per crossing rather than every frame.
  const armed = useSharedValue(false);
  const flash = useSharedValue(0);

  useEffect(() => {
    flash.value = highlighted
      ? withSequence(withTiming(1, { duration: 160 }), withTiming(0, { duration: 1100 }))
      : withTiming(0, { duration: 200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted]);

  const reply = () => onReply(message);
  const react = () => onToggleReaction(message, DOUBLE_TAP_EMOJI);

  const pan = Gesture.Pan()
    // Rightward intent only, and vertical movement hands the touch back to
    // the list — otherwise every scroll would nudge a bubble sideways.
    .activeOffsetX(14)
    .failOffsetX(-14)
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      const offset = replyDragOffset(event.translationX);
      drag.value = offset;
      const past = shouldTriggerReply(offset);
      if (past !== armed.value) {
        armed.value = past;
        if (past) runOnJS(haptic.tap)();
      }
    })
    .onEnd(() => {
      if (shouldTriggerReply(drag.value)) runOnJS(reply)();
    })
    // Springs back on a cancelled gesture too, not just a clean release.
    .onFinalize(() => {
      armed.value = false;
      drag.value = withSpring(0, { damping: 18, stiffness: 280 });
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .enabled(reactable)
    .onEnd((_event, success) => {
      if (success) runOnJS(react)();
    });

  const gesture = Gesture.Simultaneous(pan, doubleTap);

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value }],
  }));

  const hintStyle = useAnimatedStyle(() => {
    const progress = replyProgress(drag.value);
    return {
      opacity: progress,
      transform: [{ scale: 0.6 + progress * 0.4 }, { translateX: drag.value }],
    };
  });

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value * 0.28 }));

  return (
    <View style={{ alignItems: outgoing ? 'flex-end' : 'flex-start' }}>
      <View style={styles.row}>
        <Animated.View pointerEvents="none" style={[styles.replyHint, hintStyle]}>
          <View style={[styles.replyHintDisc, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="arrow-undo" size={15} color={colors.primary} />
          </View>
        </Animated.View>

        <GestureDetector gesture={gesture}>
          <Animated.View style={bubbleStyle}>
            <Pressable
              onLongPress={(e) => onLongPress(message, e.nativeEvent.pageX, e.nativeEvent.pageY)}
              accessibilityHint={
                reactable
                  ? 'Swipe right to reply, double-tap to react, hold for more actions'
                  : 'Swipe right to reply, hold for more actions'
              }
              style={[
                styles.bubble,
                outgoing
                  ? { backgroundColor: colors.outgoingBubble, borderBottomRightRadius: 4 }
                  : { backgroundColor: colors.incomingBubble, borderBottomLeftRadius: 4 },
              ]}
            >
              <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary }, flashStyle]}
              />

              {isBot ? (
                <Text style={{ fontSize: 10.5, fontFamily: f.bold, color: colors.outgoingMeta }}>
                  🤖 Bot
                </Text>
              ) : null}

              {parent ? (
                <QuotedMessage
                  message={parent}
                  contactName={contactName}
                  onPress={() => onQuotePress(parent.id)}
                />
              ) : null}

              {message.content_type === 'image' && message.media_url ? (
                <MediaImage relativeUrl={message.media_url} />
              ) : null}

              {message.content_type === 'audio' && message.media_url ? (
                <AudioBubble mediaUrl={message.media_url} outgoing={outgoing} />
              ) : null}

              {(message.content_type === 'video' || message.content_type === 'document') &&
              !isUploading(message) ? (
                <MediaAttachment message={message} outgoing={outgoing} />
              ) : null}

              {UNRENDERED_TYPES.includes(message.content_type) || isUploading(message) ? (
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
                {message.pinned_at ? (
                  <Ionicons
                    name="pin"
                    size={11}
                    color={outgoing ? colors.outgoingMeta : colors.textFaint}
                    accessibilityLabel="Pinned"
                  />
                ) : null}
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
          </Animated.View>
        </GestureDetector>
      </View>

      {groups.length > 0 ? (
        <View style={styles.reactions}>
          {groups.map((group) => (
            <Pressable
              key={group.emoji}
              onPress={() => onToggleReaction(message, group.emoji)}
              disabled={!reactable}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={
                group.mine
                  ? `Remove your ${group.emoji} reaction`
                  : `React with ${group.emoji}`
              }
              style={[
                styles.reactionPill,
                {
                  backgroundColor: group.mine ? colors.primarySoft : colors.surface,
                  borderColor: group.mine ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={{ fontSize: 12 }}>{group.emoji}</Text>
              {group.count > 1 ? (
                <Text style={{ fontSize: 10.5, fontFamily: f.semibold, color: colors.textMuted }}>
                  {group.count}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Shrinks to the bubble so the reply arrow can be anchored just outside
  // its leading edge on either side of the thread.
  row: { maxWidth: '82%' },
  replyHint: {
    position: 'absolute',
    left: -36,
    top: 0,
    bottom: 0,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyHintDisc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 3,
    overflow: 'hidden',
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
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 190,
    paddingVertical: 2,
  },
  reactions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: -4,
    marginBottom: 2,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
