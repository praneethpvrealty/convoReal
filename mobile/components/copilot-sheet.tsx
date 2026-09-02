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
import { CopilotEntityPicker } from '@/components/copilot-entity-picker';
import { TourBodyText } from '@/components/copilot-tour';
import { useAuthStore } from '@/lib/auth-store';
import { useT } from '@/lib/use-t';
import {
  askCopilot,
  appHrefForWebRoute,
  createSupportTicket,
  executeCopilotAction,
  sendCopilotFeedback,
  type CopilotAnswer,
  type CopilotActionExecutionResult,
  type CopilotCoverage,
} from '@/lib/copilot';
import {
  activeCopilotEntityQuery,
  copilotEntitySymbol,
  insertCopilotEntity,
  type CopilotEntityReference,
  type CopilotEntitySuggestion,
} from '@/lib/copilot-entities';
import { MOBILE_TOURS } from '@/lib/copilot-tours';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';

type ActionState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

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
  actionState?: ActionState;
  actionOutcome?: CopilotActionExecutionResult['outcome'];
  actionError?: string;
}

const SUGGESTIONS = [
  'How do I add a contact?',
  'Send message to many people',
  'Property views kaise dekhu?',
];

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
  const t = useT();
  const pathname = usePathname();
  const session = useAuthStore((s) => s.session);

  const [turns, setTurns] = useState<SheetTurn[]>([]);
  const [input, setInput] = useState('');
  const [entities, setEntities] = useState<CopilotEntityReference[]>([]);
  const [busy, setBusy] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [supportFor, setSupportFor] = useState<number | null>(null);
  const [supportChannel, setSupportChannel] = useState<'whatsapp' | 'email'>(
    'whatsapp'
  );
  const [supportDest, setSupportDest] = useState('');
  const [supportBusy, setSupportBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const executingActionIdsRef = useRef(new Set<string>());
  const activeEntity = activeCopilotEntityQuery(input, entities);

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
    const messageEntities = entities;
    setEntities([]);
    setBusy(true);
    try {
      const answer = await askCopilot({
        message,
        pathname,
        history,
        entities: messageEntities,
      });
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

  const updateInput = (value: string) => {
    setInput(value);
    setEntities((current) =>
      current.filter((entity) =>
        value
          .toLocaleLowerCase()
          .includes(
            `${copilotEntitySymbol(entity.kind)}${entity.label}`.toLocaleLowerCase()
          )
      )
    );
  };

  const selectEntity = (entity: CopilotEntitySuggestion) => {
    if (!activeEntity) return;
    haptic.tap();
    setInput((value) => insertCopilotEntity(value, activeEntity, entity));
    setEntities((current) => [
      ...current.filter(
        (item) => !(item.kind === entity.kind && item.id === entity.id)
      ),
      { kind: entity.kind, id: entity.id, label: entity.label },
    ]);
  };

  const updateActionTurn = (
    actionId: string,
    update: Partial<
      Pick<SheetTurn, 'actionState' | 'actionOutcome' | 'actionError'>
    >
  ) => {
    setTurns((current) =>
      current.map((turn) =>
        turn.answer?.action?.id === actionId ? { ...turn, ...update } : turn
      )
    );
  };

  const cancelAction = (actionId: string) => {
    if (executingActionIdsRef.current.has(actionId)) return;
    haptic.tap();
    updateActionTurn(actionId, {
      actionState: 'cancelled',
      actionError: undefined,
    });
  };

  const confirmAction = async (actionId: string) => {
    const turn = turns.find((item) => item.answer?.action?.id === actionId);
    const action = turn?.answer?.action;
    if (
      !action ||
      turn.actionState === 'running' ||
      turn.actionState === 'completed' ||
      turn.actionState === 'cancelled'
    ) {
      return;
    }
    if (executingActionIdsRef.current.has(actionId)) return;
    executingActionIdsRef.current.add(actionId);

    if (action.type === 'share_property') {
      const destination = appHrefForWebRoute(action.navigateTo);
      if (!destination) {
        executingActionIdsRef.current.delete(action.id);
        updateActionTurn(action.id, {
          actionState: 'failed',
          actionError: 'Could not open the property share flow.',
        });
        return;
      }
      haptic.tap();
      updateActionTurn(action.id, { actionState: 'completed' });
      onClose();
      setTimeout(() => router.push(destination as Href), 200);
      return;
    }

    updateActionTurn(action.id, {
      actionState: 'running',
      actionError: undefined,
    });
    try {
      const result = await executeCopilotAction(action);
      updateActionTurn(action.id, {
        actionState: 'completed',
        actionOutcome: result.outcome,
      });
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      void queryClient.invalidateQueries({
        queryKey: ['appointment', action.entity.id],
      });
      haptic.success();
    } catch (error) {
      updateActionTurn(action.id, {
        actionState: 'failed',
        actionError: friendlyError(
          error instanceof Error ? error.message : String(error)
        ),
      });
      haptic.warn();
    } finally {
      executingActionIdsRef.current.delete(action.id);
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
    <BottomSheet visible={visible} onClose={onClose} title={t('copilot.title')}>
      <ScrollView
        ref={scrollRef}
        style={sheetScrollArea}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.bubble, styles.assistantBubble, { backgroundColor: colors.surfaceSunken }]}>
          <Text style={[type.bodySmall, { color: colors.text }]}>{t('copilot.greeting')}</Text>
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

        {turns.map((turn, i) => {
          const a = turn.answer;
          const coverage: CopilotCoverage | undefined = a?.coverage;
          const appHref = a?.navigateTo ? appHrefForWebRoute(a.navigateTo) : null;
          const showSupport =
            turn.role === 'assistant' &&
            !!turn.question &&
            !turn.supportRef &&
            (coverage === 'none' || coverage === 'partial');
          return (
            <View
              key={i}
              style={turn.role === 'user' ? styles.userWrap : styles.assistantWrap}
            >
              <View
                style={[
                  styles.bubble,
                  turn.role === 'user'
                    ? [styles.userBubble, { backgroundColor: colors.primary }]
                    : [styles.assistantBubble, { backgroundColor: colors.surfaceSunken }],
                ]}
              >
                <TourBodyText
                  text={turn.text}
                  color={turn.role === 'user' ? colors.onPrimary : colors.text}
                  boldColor={turn.role === 'user' ? colors.onPrimary : colors.text}
                />
              </View>

              {turn.role === 'assistant' && a?.action ? (
                <View
                  style={[
                    styles.actionCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.glassBorder,
                    },
                  ]}
                >
                  <View style={styles.actionHeader}>
                    <View
                      style={[
                        styles.actionIcon,
                        { backgroundColor: colors.primarySoft },
                      ]}
                    >
                      <Ionicons
                        name={
                          a.action.type === 'complete_event'
                            ? 'calendar-outline'
                            : 'share-social-outline'
                        }
                        size={17}
                        color={colors.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.actionTitle,
                          { color: colors.text, fontFamily: f.bold },
                        ]}
                      >
                        {a.action.title}
                      </Text>
                      <Text
                        style={[
                          styles.actionDescription,
                          { color: colors.textMuted, fontFamily: f.regular },
                        ]}
                      >
                        {a.action.description}
                      </Text>
                    </View>
                  </View>

                  {turn.actionState === 'completed' ? (
                    <View style={styles.actionResult}>
                      <Ionicons
                        name="checkmark-circle"
                        size={16}
                        color={colors.success}
                      />
                      <Text
                        style={[
                          styles.actionResultText,
                          { color: colors.success, fontFamily: f.semibold },
                        ]}
                      >
                        {a.action.type === 'share_property'
                          ? 'The property share flow is ready. Nothing was sent automatically.'
                          : turn.actionOutcome === 'already_completed'
                            ? 'This event was already completed. No duplicate change was made.'
                            : 'Done — the calendar event is marked completed.'}
                      </Text>
                    </View>
                  ) : turn.actionState === 'cancelled' ? (
                    <Text
                      style={[
                        styles.actionResultText,
                        { color: colors.textFaint, fontFamily: f.medium },
                      ]}
                    >
                      Cancelled — nothing changed.
                    </Text>
                  ) : (
                    <>
                      {turn.actionState === 'failed' ? (
                        <View style={styles.actionResult}>
                          <Ionicons
                            name="warning-outline"
                            size={16}
                            color={colors.danger}
                          />
                          <Text
                            style={[
                              styles.actionResultText,
                              { color: colors.danger, fontFamily: f.medium },
                            ]}
                          >
                            {turn.actionError || 'Could not run this action.'}
                          </Text>
                        </View>
                      ) : null}
                      <View style={styles.actionButtons}>
                        <Pressable
                          onPress={() => void confirmAction(a.action!.id)}
                          disabled={turn.actionState === 'running'}
                          accessibilityRole="button"
                          style={[
                            styles.actionConfirm,
                            {
                              backgroundColor: colors.primary,
                              opacity: turn.actionState === 'running' ? 0.5 : 1,
                            },
                          ]}
                        >
                          {turn.actionState === 'running' ? (
                            <Ionicons
                              name="sync"
                              size={14}
                              color={colors.onPrimary}
                            />
                          ) : null}
                          <Text
                            style={[
                              styles.actionButtonLabel,
                              { color: colors.onPrimary, fontFamily: f.bold },
                            ]}
                          >
                            {turn.actionState === 'failed'
                              ? 'Try again'
                              : a.action.confirmLabel}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => cancelAction(a.action!.id)}
                          disabled={turn.actionState === 'running'}
                          accessibilityRole="button"
                          style={[
                            styles.actionCancel,
                            {
                              borderColor: colors.border,
                              opacity: turn.actionState === 'running' ? 0.5 : 1,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.actionButtonLabel,
                              {
                                color: colors.textMuted,
                                fontFamily: f.semibold,
                              },
                            ]}
                          >
                            {t('common.cancel')}
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              ) : null}

              {turn.role === 'assistant' && a ? (
                <View style={styles.actions}>
                  {a.tourId
                    ? actionChip(t('copilot.startTour'), 'navigate-outline', () => {
                        onStartTour(a.tourId!);
                      })
                    : null}
                  {coverage === 'web_only'
                    ? actionChip(t('copilot.openDesktop'), 'laptop-outline', () => {
                        void Linking.openURL(a.webUrl ?? 'https://www.convoreal.com');
                      })
                    : null}
                  {!a.tourId && coverage !== 'web_only' && appHref
                    ? actionChip(t('copilot.takeMeThere'), 'arrow-forward-outline', () => {
                        onClose();
                        router.push(appHref as Href);
                      })
                    : null}
                </View>
              ) : null}

              {turn.role === 'assistant' && coverage === 'web_only' ? (
                <Text style={[styles.hint, { fontFamily: f.medium, color: colors.textFaint }]}>
                  {t('copilot.webOnlyHint')}
                </Text>
              ) : null}

              {turn.role === 'assistant' && a?.unsupported ? (
                <Text style={[styles.hint, { fontFamily: f.medium, color: colors.textFaint }]}>
                  {`\u{1F4A1} ${t('copilot.featureNoted')}`}
                </Text>
              ) : null}

              {turn.supportRef ? (
                <Text style={[styles.hint, { fontFamily: f.semibold, color: colors.success }]}>
                  {`✅ ${t('copilot.supportSent')} ${turn.supportRef}. ${t('copilot.supportReply')} ${turn.supportChannel === 'email' ? 'email' : 'WhatsApp'}.`}
                </Text>
              ) : null}

              {showSupport && supportFor !== i ? (
                <View style={styles.actions}>
                  {coverage === 'partial' ? (
                    <Text style={[styles.hint, { fontFamily: f.medium, color: colors.textFaint }]}>
                      {t('copilot.partialHint')}
                    </Text>
                  ) : null}
                  {actionChip(t('copilot.askSupport'), 'help-buoy-outline', () => openSupport(i))}
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
                    {t('copilot.supportWhere')}
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
                      supportChannel === 'whatsapp'
                        ? t('copilot.supportPhone')
                        : t('copilot.supportEmail')
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
                        {supportBusy ? t('copilot.supportSending') : t('copilot.supportSend')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setSupportFor(null)}
                      accessibilityRole="button"
                      hitSlop={8}
                    >
                      <Text style={[styles.hint, { fontFamily: f.semibold, color: colors.textFaint }]}>
                        {t('common.cancel')}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {turn.role === 'assistant' && a?.cacheId ? (
                <View style={styles.feedbackRow}>
                  {turn.voted ? (
                    <Text style={[styles.hint, { fontFamily: f.medium, color: colors.textFaint }]}>
                      {t('copilot.thanks')}
                    </Text>
                  ) : (
                    <>
                      <Text style={[styles.hint, { fontFamily: f.medium, color: colors.textFaint }]}>
                        {t('copilot.helpful')}
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
            <Text style={[type.bodySmall, { color: colors.textFaint }]}>{t('copilot.typing')}</Text>
          </View>
        ) : null}

        {showGuides ? (
          <View style={styles.guides}>
            <Text style={[styles.guidesLabel, { fontFamily: f.bold, color: colors.textFaint }]}>
              {t('copilot.guides').toUpperCase()}
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

      {activeEntity ? (
        <CopilotEntityPicker active={activeEntity} onSelect={selectEntity} />
      ) : null}

      <View style={[styles.composer, { borderTopColor: colors.border }]}>
        {entities.length > 0 ? (
          <View style={styles.entityChips}>
            {entities.map((entity) => (
              <Pressable
                key={`${entity.kind}:${entity.id}`}
                onPress={() => {
                  const token = `${copilotEntitySymbol(entity.kind)}${entity.label}`;
                  updateInput(input.replace(token, '').replace(/\s{2,}/g, ' '));
                }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${entity.label}`}
                style={[
                  styles.entityChip,
                  { backgroundColor: colors.primarySoft },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.entityChipLabel,
                    { color: colors.primary, fontFamily: f.semibold },
                  ]}
                >
                  {copilotEntitySymbol(entity.kind)}{entity.label}
                </Text>
                <Ionicons name="close" size={13} color={colors.primary} />
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.composerRow}>
          <TextInput
            value={input}
            onChangeText={updateInput}
            placeholder="Ask… Use # properties, @ contacts, & events"
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
  actionCard: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  actionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: { fontSize: 13.5 },
  actionDescription: { marginTop: 3, fontSize: 11.5, lineHeight: 16 },
  actionResult: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  actionResultText: { flex: 1, fontSize: 11.5, lineHeight: 16 },
  actionButtons: { flexDirection: 'row', gap: spacing.sm },
  actionConfirm: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
  },
  actionCancel: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
  },
  actionButtonLabel: { fontSize: 12 },
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
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 2,
    gap: spacing.sm,
  },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  entityChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  entityChip: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  entityChipLabel: { maxWidth: 250, fontSize: 11.5 },
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
