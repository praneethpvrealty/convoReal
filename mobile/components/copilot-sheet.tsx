import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { TourBodyText } from '@/components/copilot-tour';
import { useAuthStore } from '@/lib/auth-store';
import {
  askCopilot,
  appHrefForWebRoute,
  createSupportTicket,
  sendCopilotFeedback,
  type CopilotAnswer,
  type CopilotCoverage,
} from '@/lib/copilot';
import { MOBILE_TOURS } from '@/lib/copilot-tours';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';

// ------------------------------------------------------------------
// The helper chat, mobile edition. Same brain as the web panel (the
// /api/copilot engine), different affordances per answer:
//   full      → answer text, plus a "Start guided tour" button when a
//               native tour covers it
//   web_only  → answer text + an "Open on desktop web" link
//   partial   → answer text + the support-team escalation underneath
//   none      → the support-team escalation front and centre
// Escalations file a help-desk ticket; the team answers back on the
// WhatsApp number or email the user picks here.
// ------------------------------------------------------------------

interface SheetTurn {
  role: 'user' | 'assistant';
  text: string;
  answer?: CopilotAnswer;
  question?: string;
  supportRef?: string;
  supportChannel?: 'whatsapp' | 'email';
  voted?: 'up' | 'down';
}

const SUGGESTIONS = [
  'How do I add a contact?',
  'Send message to many people',
  'Property views kaise dekhu?',
];

const GREETING =
  'Hi! I can show you around or answer questions about ConvoReal. \u{1F44B}';

export function CopilotSheet({
  visible,
  onClose,
  onStartTour,
}: {
  visible: boolean;
  onClose: () => void;
  onStartTour: (tourId: string) => void;
}) {
  const { colors, fonts: f, type } = useTheme();
  const pathname = usePathname();
  const session = useAuthStore((s) => s.session);

  const [turns, setTurns] = useState<SheetTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [supportFor, setSupportFor] = useState<number | null>(null);
  const [supportChannel, setSupportChannel] = useState<'whatsapp' | 'email'>(
    'whatsapp'
  );
  const [supportDest, setSupportDest] = useState('');
  const [supportBusy, setSupportBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const timer = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }),
      80
    );
    return () => clearTimeout(timer);
  }, [turns, busy]);

  const openSupport = (turnIndex: number) => {
    const phone = session?.user.phone;
    setSupportChannel(phone ? 'whatsapp' : 'email');
    setSupportDest(phone ? `+${phone.replace(/^\+/, '')}` : (session?.user.email ?? ''));
    setSupportFor(turnIndex);
  };

  const pickChannel = (channel: 'whatsapp' | 'email') => {
    setSupportChannel(channel);
    const phone = session?.user.phone;
    setSupportDest(
      channel === 'whatsapp'
        ? phone
          ? `+${phone.replace(/^\+/, '')}`
          : ''
        : (session?.user.email ?? '')
    );
  };

  const fileTicket = async (turnIndex: number) => {
    const turn = turns[turnIndex];
    if (!turn?.question || supportBusy) return;
    setSupportBusy(true);
    try {
      const { reference } = await createSupportTicket({
        question: turn.question,
        helperReply: turn.text,
        coverage: turn.answer?.coverage,
        pathname,
        channel: supportChannel,
        destination: supportDest.trim(),
      });
      haptic.success();
      setTurns((t) =>
        t.map((x, i) =>
          i === turnIndex
            ? { ...x, supportRef: reference, supportChannel }
            : x
        )
      );
      setSupportFor(null);
    } catch (err) {
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          text: friendlyError(err instanceof Error ? err.message : String(err)),
        },
      ]);
    } finally {
      setSupportBusy(false);
    }
  };

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    setInput('');
    setShowGuides(false);
    const history = turns
      .slice(-6)
      .map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: 'user', text: message }]);
    setBusy(true);
    try {
      const answer = await askCopilot({ message, pathname, history });
      setTurns((t) => [
        ...t,
        { role: 'assistant', text: answer.reply, answer, question: message },
      ]);
    } catch (err) {
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          text: friendlyError(err instanceof Error ? err.message : String(err)),
        },
      ]);
      setShowGuides(true);
    } finally {
      setBusy(false);
    }
  };

  const actionChip = (label: string, icon: keyof typeof Ionicons.glyphMap, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.actionChip, { backgroundColor: colors.primarySoft }]}
    >
      <Ionicons name={icon} size={14} color={colors.primary} />
      <Text style={[styles.actionChipLabel, { fontFamily: f.semibold, color: colors.primary }]}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Helper">
      <ScrollView
        ref={scrollRef}
        style={sheetScrollArea}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.bubble, styles.assistantBubble, { backgroundColor: colors.surfaceSunken }]}>
          <Text style={[type.bodySmall, { color: colors.text }]}>{GREETING}</Text>
        </View>

        {turns.length === 0 ? (
          <View style={styles.chips}>
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s}
                onPress={() => void send(s)}
                accessibilityRole="button"
                style={[styles.chip, { borderColor: colors.border }]}
              >
                <Text style={[styles.chipLabel, { fontFamily: f.medium, color: colors.textMuted }]}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {turns.map((t, i) => {
          const a = t.answer;
          const coverage: CopilotCoverage | undefined = a?.coverage;
          const appHref = a?.navigateTo ? appHrefForWebRoute(a.navigateTo) : null;
          const showSupport =
            t.role === 'assistant' &&
            !!t.question &&
            !t.supportRef &&
            (coverage === 'none' || coverage === 'partial');
          return (
            <View
              key={i}
              style={t.role === 'user' ? styles.userWrap : styles.assistantWrap}
            >
              <View
                style={[
                  styles.bubble,
                  t.role === 'user'
                    ? [styles.userBubble, { backgroundColor: colors.primary }]
                    : [styles.assistantBubble, { backgroundColor: colors.surfaceSunken }],
                ]}
              >
                <TourBodyText
                  text={t.text}
                  color={t.role === 'user' ? colors.onPrimary : colors.text}
                  boldColor={t.role === 'user' ? colors.onPrimary : colors.text}
                />
              </View>

              {t.role === 'assistant' && a ? (
                <View style={styles.actions}>
                  {a.tourId
                    ? actionChip('Show me — start the tour', 'navigate-outline', () => {
                        onStartTour(a.tourId!);
                      })
                    : null}
                  {coverage === 'web_only'
                    ? actionChip('Open on desktop web', 'laptop-outline', () => {
                        void Linking.openURL(a.webUrl ?? 'https://www.convoreal.com');
                      })
                    : null}
                  {!a.tourId && coverage !== 'web_only' && appHref
                    ? actionChip('Take me there', 'arrow-forward-outline', () => {
                        onClose();
                        router.push(appHref as Href);
                      })
                    : null}
                </View>
              ) : null}

              {t.role === 'assistant' && coverage === 'web_only' ? (
                <Text style={[styles.hint, { fontFamily: f.medium, color: colors.textFaint }]}>
                  This one lives on the desktop web dashboard.
                </Text>
              ) : null}

              {t.role === 'assistant' && a?.unsupported ? (
                <Text style={[styles.hint, { fontFamily: f.medium, color: colors.textFaint }]}>
                  {'\u{1F4A1} Noted as a feature request for the ConvoReal team.'}
                </Text>
              ) : null}

              {t.supportRef ? (
                <Text style={[styles.hint, { fontFamily: f.semibold, color: colors.success }]}>
                  {`✅ Sent to our support team — reference ${t.supportRef}. We'll get back to you on ${t.supportChannel === 'email' ? 'email' : 'WhatsApp'}.`}
                </Text>
              ) : null}

              {showSupport && supportFor !== i ? (
                <View style={styles.actions}>
                  {coverage === 'partial' ? (
                    <Text style={[styles.hint, { fontFamily: f.medium, color: colors.textFaint }]}>
                      I could only partly help with this one.
                    </Text>
                  ) : null}
                  {actionChip('Ask the support team', 'help-buoy-outline', () => openSupport(i))}
                </View>
              ) : null}

              {showSupport && supportFor === i ? (
                <View
                  style={[
                    styles.supportCard,
                    { backgroundColor: colors.surface, borderColor: colors.glassBorder },
                  ]}
                >
                  <Text style={[styles.supportTitle, { fontFamily: f.bold, color: colors.text }]}>
                    Where should our team reply?
                  </Text>
                  <View style={styles.channelRow}>
                    {(['whatsapp', 'email'] as const).map((ch) => (
                      <Pressable
                        key={ch}
                        onPress={() => pickChannel(ch)}
                        accessibilityRole="button"
                        style={[
                          styles.channelChip,
                          {
                            borderColor:
                              supportChannel === ch ? colors.primary : colors.border,
                            backgroundColor:
                              supportChannel === ch ? colors.primarySoft : 'transparent',
                          },
                        ]}
                      >
                        <Ionicons
                          name={ch === 'whatsapp' ? 'logo-whatsapp' : 'mail-outline'}
                          size={14}
                          color={supportChannel === ch ? colors.primary : colors.textMuted}
                        />
                        <Text
                          style={[
                            styles.channelLabel,
                            {
                              fontFamily: f.semibold,
                              color: supportChannel === ch ? colors.primary : colors.textMuted,
                            },
                          ]}
                        >
                          {ch === 'whatsapp' ? 'WhatsApp' : 'Email'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    value={supportDest}
                    onChangeText={setSupportDest}
                    placeholder={
                      supportChannel === 'whatsapp' ? 'WhatsApp number' : 'Email address'
                    }
                    placeholderTextColor={colors.textFaint}
                    keyboardType={
                      supportChannel === 'whatsapp' ? 'phone-pad' : 'email-address'
                    }
                    autoCapitalize="none"
                    style={[
                      styles.supportInput,
                      {
                        fontFamily: f.regular,
                        color: colors.text,
                        borderColor: colors.border,
                        backgroundColor: colors.surfaceSunken,
                      },
                    ]}
                  />
                  <View style={styles.supportActions}>
                    <Pressable
                      onPress={() => void fileTicket(i)}
                      disabled={supportBusy || !supportDest.trim()}
                      accessibilityRole="button"
                      style={[
                        styles.supportSend,
                        {
                          backgroundColor: colors.primary,
                          opacity: supportBusy || !supportDest.trim() ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.supportSendLabel, { fontFamily: f.bold, color: colors.onPrimary }]}>
                        {supportBusy ? 'Sending…' : 'Send to support'}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setSupportFor(null)}
                      accessibilityRole="button"
                      hitSlop={8}
                    >
                      <Text style={[styles.hint, { fontFamily: f.semibold, color: colors.textFaint }]}>
                        Cancel
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {t.role === 'assistant' && a?.cacheId ? (
                <View style={styles.feedbackRow}>
                  {t.voted ? (
                    <Text style={[styles.hint, { fontFamily: f.medium, color: colors.textFaint }]}>
                      Thanks for the feedback!
                    </Text>
                  ) : (
                    <>
                      <Text style={[styles.hint, { fontFamily: f.medium, color: colors.textFaint }]}>
                        Helpful?
                      </Text>
                      {(['up', 'down'] as const).map((vote) => (
                        <Pressable
                          key={vote}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={vote === 'up' ? 'Helpful' : 'Not helpful'}
                          onPress={() => {
                            haptic.tap();
                            setTurns((x) =>
                              x.map((turn, j) => (j === i ? { ...turn, voted: vote } : turn))
                            );
                            sendCopilotFeedback(a.cacheId!, vote);
                          }}
                        >
                          <Ionicons
                            name={vote === 'up' ? 'thumbs-up-outline' : 'thumbs-down-outline'}
                            size={14}
                            color={colors.textFaint}
                          />
                        </Pressable>
                      ))}
                    </>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}

        {busy ? (
          <View style={[styles.bubble, styles.assistantBubble, { backgroundColor: colors.surfaceSunken }]}>
            <Text style={[type.bodySmall, { color: colors.textFaint }]}>Typing…</Text>
          </View>
        ) : null}

        {showGuides ? (
          <View style={styles.guides}>
            <Text style={[styles.guidesLabel, { fontFamily: f.bold, color: colors.textFaint }]}>
              STEP-BY-STEP GUIDES
            </Text>
            {MOBILE_TOURS.map((tour) => (
              <Pressable
                key={tour.id}
                onPress={() => onStartTour(tour.id)}
                accessibilityRole="button"
                style={[
                  styles.guideRow,
                  { backgroundColor: colors.surface, borderColor: colors.glassBorder },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.guideTitle, { fontFamily: f.semibold, color: colors.text }]}>
                    {tour.title}
                  </Text>
                  <Text style={[styles.guideDesc, { fontFamily: f.regular, color: colors.textMuted }]}>
                    {tour.description}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.composer, { borderTopColor: colors.border }]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask me anything…"
          placeholderTextColor={colors.textFaint}
          maxLength={500}
          accessibilityLabel="Ask the helper"
          onSubmitEditing={() => void send(input)}
          returnKeyType="send"
          style={[
            styles.input,
            {
              fontFamily: f.regular,
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surfaceSunken,
            },
          ]}
        />
        <Pressable
          onPress={() => void send(input)}
          disabled={busy || !input.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={[
            styles.sendBtn,
            { backgroundColor: colors.primary, opacity: busy || !input.trim() ? 0.4 : 1 },
          ]}
        >
          <Ionicons name="send" size={16} color={colors.onPrimary} />
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  bubble: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  assistantBubble: { alignSelf: 'flex-start', maxWidth: '88%', borderTopLeftRadius: 4 },
  userBubble: { alignSelf: 'flex-end', maxWidth: '88%', borderBottomRightRadius: 4 },
  userWrap: { alignItems: 'flex-end', gap: 4 },
  assistantWrap: { alignItems: 'flex-start', gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipLabel: { fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  actionChipLabel: { fontSize: 12.5 },
  hint: { fontSize: 11.5, lineHeight: 15 },
  supportCard: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  supportTitle: { fontSize: 13.5 },
  channelRow: { flexDirection: 'row', gap: spacing.sm },
  channelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  channelLabel: { fontSize: 12 },
  supportInput: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 13.5,
  },
  supportActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  supportSend: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  supportSendLabel: { fontSize: 12.5 },
  feedbackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  guides: { gap: spacing.sm, marginTop: spacing.sm },
  guidesLabel: { fontSize: 10, letterSpacing: 1.2 },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  guideTitle: { fontSize: 13.5 },
  guideDesc: { fontSize: 12, marginTop: 1 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 2,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontSize: 14,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
