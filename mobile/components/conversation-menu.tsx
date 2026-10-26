import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { SectionLabel } from '@/components/ui';
import {
  setConversationArchived,
  setConversationStatus,
} from '@/lib/conversation-actions';
import {
  CONVERSATION_CLOSE_NOTE_MAX_LENGTH,
  CONVERSATION_CLOSE_REASONS,
  type ConversationCloseReason,
} from '@/lib/conversation-closure';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { ConversationStatus } from '@/lib/types';

type IconName = ComponentProps<typeof Ionicons>['name'];

const STATUS_OPTIONS: {
  value: ConversationStatus;
  label: string;
  icon: IconName;
}[] = [
  { value: 'open', label: 'Open', icon: 'chatbubble-ellipses-outline' },
  {
    value: 'pending',
    label: 'Pending — needs your reply',
    icon: 'time-outline',
  },
  { value: 'closed', label: 'Closed', icon: 'checkmark-done-outline' },
];

/** Thread header ⋮ menu: open the records behind the chat, change the
 *  conversation's queue status, or archive it. Mirrors the web inbox's
 *  per-conversation controls. */
export function ConversationMenu({
  visible,
  onClose,
  conversationId,
  contactId,
  status,
  isArchived,
}: {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  /** Absent on group threads, which have no single contact behind them. */
  contactId?: string;
  status?: ConversationStatus;
  isArchived?: boolean;
}) {
  const { colors, fonts: f } = useTheme();
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeReason, setCloseReason] = useState<ConversationCloseReason>(
    CONVERSATION_CLOSE_REASONS[0].value
  );
  const [closeNote, setCloseNote] = useState('');
  const { show, dialogProps } = useAppDialog();

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      haptic.success();
      dismiss();
    } catch (e) {
      haptic.warn();
      show({
        title: 'Could not update',
        message: e instanceof Error ? e.message : 'Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    setClosing(false);
    setCloseReason(CONVERSATION_CLOSE_REASONS[0].value);
    setCloseNote('');
    onClose();
  }

  if (closing) {
    const noteRequired = closeReason === 'other';
    return (
      <BottomSheet visible={visible} onClose={dismiss} title="Close lead">
        <ScrollView
          style={sheetScrollArea}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            gap: spacing.md,
            paddingBottom: spacing.sm,
          }}
        >
          <Text
            style={{ color: colors.textMuted, fontSize: 13.5, lineHeight: 20 }}
          >
            Choose the clearest reason. It stays searchable in Closed leads, and
            a new customer reply will reopen the chat.
          </Text>
          <SectionLabel text="Reason" />
          <View style={styles.reasonWrap}>
            {CONVERSATION_CLOSE_REASONS.map((option) => {
              const active = closeReason === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setCloseReason(option.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  style={[
                    styles.reason,
                    {
                      backgroundColor: active
                        ? colors.primarySoft
                        : colors.glass,
                      borderColor: active ? colors.primary : colors.glassBorder,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? colors.primary : colors.text,
                      fontFamily: active ? f.bold : f.medium,
                      fontSize: 13,
                    }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.noteHeader}>
            <SectionLabel
              text={`Note ${noteRequired ? '(required)' : '(optional)'}`}
            />
            <Text style={{ color: colors.textFaint, fontSize: 11 }}>
              {closeNote.length}/{CONVERSATION_CLOSE_NOTE_MAX_LENGTH}
            </Text>
          </View>
          <TextInput
            value={closeNote}
            onChangeText={setCloseNote}
            maxLength={CONVERSATION_CLOSE_NOTE_MAX_LENGTH}
            multiline
            placeholder="Add context for the team"
            placeholderTextColor={colors.textFaint}
            style={[
              styles.note,
              {
                color: colors.text,
                backgroundColor: colors.glass,
                borderColor: colors.glassBorder,
                fontFamily: f.medium,
              },
            ]}
          />
          <View style={styles.actions}>
            <Pressable
              onPress={() => setClosing(false)}
              disabled={busy}
              accessibilityRole="button"
              style={[styles.action, { backgroundColor: colors.glass }]}
            >
              <Text style={{ color: colors.text, fontFamily: f.bold }}>
                Back
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                run(() =>
                  setConversationStatus(
                    conversationId,
                    'closed',
                    closeReason,
                    closeNote
                  )
                )
              }
              disabled={busy || (noteRequired && !closeNote.trim())}
              accessibilityRole="button"
              style={[
                styles.action,
                {
                  backgroundColor: colors.primary,
                  opacity:
                    busy || (noteRequired && !closeNote.trim()) ? 0.5 : 1,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={{ color: colors.onPrimary, fontFamily: f.bold }}>
                  Close lead
                </Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
        <AppDialog {...dialogProps} />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Manage chat">
      <ScrollView
        style={sheetScrollArea}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          gap: spacing.sm,
          paddingBottom: spacing.sm,
        }}
      >
        {contactId ? (
          <>
            <SectionLabel text="Open" />
            {(
              [
                {
                  key: 'contact',
                  label: 'Contact profile',
                  icon: 'person-outline',
                  href: {
                    pathname: '/(app)/contact/[id]' as const,
                    params: { id: contactId },
                  },
                },
                {
                  key: 'journey',
                  label: 'Journey',
                  icon: 'git-network-outline',
                  href: {
                    pathname: '/(app)/journey' as const,
                    params: { contactId },
                  },
                },
              ] satisfies {
                key: string;
                label: string;
                icon: IconName;
                href: Href;
              }[]
            ).map((link) => (
              <Pressable
                key={link.key}
                onPress={() => {
                  onClose();
                  router.push(link.href);
                }}
                accessibilityRole="button"
                accessibilityLabel={link.label}
                style={[
                  styles.row,
                  {
                    backgroundColor: colors.glass,
                    borderColor: colors.glassBorder,
                  },
                ]}
              >
                <Ionicons name={link.icon} size={18} color={colors.text} />
                <Text
                  style={{
                    flex: 1,
                    fontSize: 14.5,
                    fontFamily: f.medium,
                    color: colors.text,
                  }}
                >
                  {link.label}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.textFaint}
                />
              </Pressable>
            ))}
          </>
        ) : null}

        <SectionLabel text="Status" />
        {STATUS_OPTIONS.map((opt) => {
          const active = status === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => {
                if (opt.value === 'closed') {
                  setClosing(true);
                  return;
                }
                void run(() =>
                  setConversationStatus(conversationId, opt.value)
                );
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.row,
                {
                  backgroundColor: active ? colors.primarySoft : colors.glass,
                  borderColor: active ? colors.primary : colors.glassBorder,
                },
              ]}
            >
              <Ionicons
                name={opt.icon}
                size={18}
                color={active ? colors.primary : colors.textMuted}
              />
              <Text
                style={{
                  flex: 1,
                  fontSize: 14.5,
                  fontFamily: active ? f.bold : f.medium,
                  color: active ? colors.primary : colors.text,
                }}
              >
                {opt.label}
              </Text>
              {active ? (
                <Ionicons name="checkmark" size={18} color={colors.primary} />
              ) : null}
            </Pressable>
          );
        })}

        <SectionLabel text="Organize" />
        <Pressable
          onPress={() =>
            run(() => setConversationArchived(conversationId, !isArchived))
          }
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={isArchived ? 'Unarchive chat' : 'Archive chat'}
          style={[
            styles.row,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
          ]}
        >
          <Ionicons
            name={isArchived ? 'arrow-undo-outline' : 'archive-outline'}
            size={18}
            color={colors.text}
          />
          <Text
            style={{
              flex: 1,
              fontSize: 14.5,
              fontFamily: f.medium,
              color: colors.text,
            }}
          >
            {isArchived ? 'Unarchive chat' : 'Archive chat'}
          </Text>
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null}
        </Pressable>

        <Text
          style={{
            fontSize: 11.5,
            color: colors.textFaint,
            textAlign: 'center',
            marginTop: spacing.xs,
          }}
        >
          Archiving hides the chat from the inbox but keeps its history. Chats
          can’t be deleted.
        </Text>
      </ScrollView>
      <AppDialog {...dialogProps} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reason: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  note: {
    minHeight: 96,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  action: {
    minHeight: 44,
    minWidth: 104,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
});
