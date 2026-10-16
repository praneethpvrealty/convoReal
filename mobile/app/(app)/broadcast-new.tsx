import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  Banner,
  FilterChip,
  PrimaryButton,
  SectionLabel,
  TextField,
} from '@/components/ui';
import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { TourTarget } from '@/components/copilot-tour';
import { apiFetch, ApiError } from '@/lib/api';
import {
  buildAudience,
  buildCsvAudience,
  draftChanged,
  readCsvAudience,
  type BroadcastDraft,
} from '@/lib/broadcast-compose';
import { MAX_CSV_CONTACTS } from '@shared/lib/broadcasts/csv-audience';
import { contactsLabel, recountOutcome } from '@shared/lib/broadcasts/recount';
import {
  BROADCAST_MESSAGE_MAX,
  broadcastMessageProblem,
  broadcastTemplateBlockReason,
  previewBroadcastUpdate,
  type BroadcastTemplateState,
} from '@shared/lib/broadcasts/carrier-template';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Tag } from '@/lib/types';

/**
 * Compose and send a broadcast from the phone.
 *
 * The agent writes the message and picks who gets it; nothing here
 * asks for a WhatsApp template. The server does everything that
 * matters — POST /api/broadcasts carries the message on the account's
 * shared broadcast template, resolves the audience, writes the
 * recipient rows, enforces the per-user rate limit and sends — so this
 * screen only assembles the payload that route already accepts from
 * the web composer.
 *
 * Audience is All, by tag, or a pasted list of numbers; custom-field
 * filters stay on the web composer.
 */
export default function NewBroadcastScreen() {
  const { colors, fonts: f } = useTheme();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [audienceType, setAudienceType] = useState<
    'all' | 'tags' | 'csv' | null
  >(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [csvText, setCsvText] = useState('');
  const [excludeTagIds, setExcludeTagIds] = useState<string[]>([]);
  const [optedInOnly, setOptedInOnly] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useAppDialog();

  // The template every hand-written broadcast rides on. An account
  // with no row yet gets one submitted to Meta here, on its own, and a
  // pending row is re-read every half minute so approval unlocks the
  // screen without reopening it.
  const {
    data: template,
    isLoading: loadingTemplate,
    isError: templateFailed,
    refetch: recheckTemplate,
  } = useQuery({
    queryKey: ['broadcast-template'],
    queryFn: async () => {
      const read = async (method: 'GET' | 'POST') =>
        (
          await apiFetch<{ data: BroadcastTemplateState }>(
            '/api/broadcasts/template',
            { method }
          )
        ).data;
      const current = await read('GET');
      return current.status === null ? read('POST') : current;
    },
    refetchInterval: (query) =>
      query.state.data?.status === 'PENDING' ? 30_000 : false,
    staleTime: 30_000,
  });

  const { data: tags } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('tags')
        .select('id, name, color')
        .order('name');
      if (err) throw err;
      return (data ?? []) as Tag[];
    },
  });

  // A sample contact so the preview shows a real name rather than a
  // placeholder — the agent should see what a recipient will see.
  const { data: sample } = useQuery({
    queryKey: ['broadcast-sample-contact'],
    queryFn: async () => {
      const { data } = await supabase
        .from('contacts')
        .select('name')
        .not('name', 'is', null)
        .limit(1)
        .maybeSingle();
      return (data ?? {}) as { name?: string | null };
    },
  });

  const { data: optedInCount } = useQuery({
    queryKey: ['contacts', 'consent-counts'],
    queryFn: async () =>
      (
        await apiFetch<{ data: { granted: number } }>(
          '/api/contacts/consent-counts'
        )
      ).data.granted,
  });

  const csvDraft = useMemo(() => readCsvAudience(csvText), [csvText]);

  const audience = useMemo(() => {
    if (audienceType === 'csv')
      return buildCsvAudience(csvDraft, excludeTagIds);
    return audienceType === 'all' ||
      (audienceType === 'tags' && tagIds.length > 0)
      ? buildAudience(audienceType, tagIds, excludeTagIds)
      : null;
  }, [audienceType, tagIds, excludeTagIds, csvDraft]);

  const {
    data: recipientCount,
    isFetching: counting,
    isError: countFailed,
    refetch: recount,
  } = useQuery({
    queryKey: ['broadcast-audience-count', audience, optedInOnly],
    enabled: audience !== null,
    queryFn: async () =>
      (
        await apiFetch<{ data: { count: number } }>(
          '/api/broadcasts/audience-count',
          {
            method: 'POST',
            body: JSON.stringify({ audience, optedInOnly }),
          }
        )
      ).data.count,
  });

  const messageProblem = broadcastMessageProblem(message);
  const blocked = broadcastTemplateBlockReason(template ?? null);

  function toggle(
    list: string[],
    setList: (next: string[]) => void,
    id: string
  ) {
    haptic.tap();
    setList(list.includes(id) ? list.filter((t) => t !== id) : [...list, id]);
  }

  const ready =
    Boolean(template) &&
    blocked === null &&
    messageProblem === null &&
    name.trim().length > 0 &&
    audience !== null &&
    !counting &&
    !countFailed &&
    (recipientCount ?? 0) > 0;

  const recipientsLabel = contactsLabel(recipientCount ?? 0);

  const latestDraft = useRef<BroadcastDraft | null>(null);
  useEffect(() => {
    latestDraft.current = {
      name: name.trim(),
      message,
      audience,
      optedInOnly,
    };
  }, [name, message, audience, optedInOnly]);

  async function confirmSend() {
    if (!ready || !audience) return;
    haptic.tap();
    const snapshot = {
      name: name.trim(),
      message,
      audience,
      optedInOnly,
    };
    setConfirming(true);
    const outcome = recountOutcome(await recount());
    setConfirming(false);
    if (!latestDraft.current || draftChanged(snapshot, latestDraft.current)) {
      dialog.show({
        title: 'The broadcast changed',
        message:
          'You edited the broadcast while the audience was being counted. Nothing was sent. Check it and tap Send again.',
      });
      return;
    }
    if (outcome.kind === 'failed') {
      dialog.show({
        title: 'Could not count recipients',
        message:
          'Nothing was sent. Check your connection and try again, so you confirm the current number.',
      });
      return;
    }
    if (outcome.kind === 'empty') {
      dialog.show({
        title: 'Nobody to send to',
        message:
          'No contacts in this audience can receive this broadcast right now. Nothing was sent.',
      });
      return;
    }
    dialog.show({
      title: 'Send this broadcast?',
      message: `“${snapshot.name}” goes to ${outcome.label} now. Sending cannot be undone.`,
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: dialog.close },
        {
          label: `Send to ${outcome.label}`,
          variant: 'primary',
          onPress: () => {
            dialog.close();
            void send(snapshot);
          },
        },
      ],
    });
  }

  async function send(payload: {
    name: string;
    message: string;
    audience: NonNullable<typeof audience>;
    optedInOnly: boolean;
  }) {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch<{ broadcastId: string }>('/api/broadcasts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
      // Straight to the campaign so its delivery counts are watched as
      // they land, rather than back to a list that says "sending".
      router.replace(`/(app)/broadcast/${res.broadcastId}`);
    } catch (err) {
      haptic.warn();
      setSending(false);
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not start this broadcast. Check your connection and try again.'
      );
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'New broadcast' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            padding: spacing.lg,
            gap: spacing.lg,
            paddingBottom: spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {error ? <Banner kind="error" text={error} /> : null}

          <TourTarget id="broadcast-compose">
            <View style={{ gap: spacing.sm }}>
              <TextField
                label="Your message"
                value={message}
                onChangeText={(next) =>
                  setMessage(next.slice(0, BROADCAST_MESSAGE_MAX))
                }
                multiline
                placeholder="e.g. Site visits at Lakeview Residences are open this Saturday and Sunday, 10 am to 5 pm. Reply to book a slot."
              />
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={{ fontSize: 11, color: colors.textFaint }}>
                  Sent as one paragraph, greeting each person by name.
                </Text>
                <Text style={{ fontSize: 11, color: colors.textFaint }}>
                  {`${message.length}/${BROADCAST_MESSAGE_MAX}`}
                </Text>
              </View>
              {loadingTemplate ? (
                <ActivityIndicator color={colors.primary} />
              ) : templateFailed ? (
                <View
                  style={[
                    styles.notice,
                    { backgroundColor: colors.warningSoft },
                  ]}
                >
                  <Text
                    style={{ flex: 1, fontSize: 12.5, color: colors.textMuted }}
                  >
                    Could not check WhatsApp setup.
                  </Text>
                  <Pressable
                    onPress={() => recheckTemplate()}
                    accessibilityRole="button"
                    accessibilityLabel="Retry checking WhatsApp setup"
                    hitSlop={8}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontFamily: f.semibold,
                        color: colors.primary,
                      }}
                    >
                      Retry
                    </Text>
                  </Pressable>
                </View>
              ) : blocked ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.notice,
                    { backgroundColor: colors.warningSoft },
                  ]}
                >
                  <Text
                    style={{ flex: 1, fontSize: 12.5, color: colors.textMuted }}
                  >
                    {blocked}
                  </Text>
                </View>
              ) : null}
            </View>
          </TourTarget>

          <TextField
            label="Campaign name"
            value={name}
            onChangeText={setName}
            placeholder="What is this campaign called?"
          />

          <View style={{ gap: spacing.sm }}>
            <SectionLabel
              text="Who receives it"
              style={{ color: colors.textMuted }}
            />
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.sm,
              }}
            >
              <FilterChip
                label="All contacts"
                active={audienceType === 'all'}
                onPress={() => {
                  haptic.tap();
                  setAudienceType('all');
                }}
              />
              <FilterChip
                label="By tag"
                active={audienceType === 'tags'}
                onPress={() => {
                  haptic.tap();
                  setAudienceType('tags');
                }}
              />
              <FilterChip
                label="CSV / pasted numbers"
                active={audienceType === 'csv'}
                onPress={() => {
                  haptic.tap();
                  setAudienceType('csv');
                }}
              />
            </View>

            {audienceType === 'tags' ? (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: spacing.sm,
                }}
              >
                {(tags ?? []).map((tag) => (
                  <FilterChip
                    key={tag.id}
                    label={tag.name}
                    active={tagIds.includes(tag.id)}
                    onPress={() => toggle(tagIds, setTagIds, tag.id)}
                  />
                ))}
              </View>
            ) : null}

            {audienceType === 'csv' ? (
              <View style={{ gap: spacing.sm }}>
                <TextInput
                  value={csvText}
                  onChangeText={setCsvText}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Paste phone numbers"
                  placeholder={
                    'One per line: phone, name (optional)\n9876543210, Asha\n+91 98765 43211'
                  }
                  placeholderTextColor={colors.textFaint}
                  style={[
                    styles.csvInput,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      color: colors.text,
                      fontFamily: f.regular,
                    },
                  ]}
                />
                <Text
                  accessibilityLiveRegion="polite"
                  style={{ fontSize: 12, color: colors.textMuted }}
                >
                  {`${csvDraft.contacts.length.toLocaleString('en-IN')} valid, ${csvDraft.skipped.toLocaleString('en-IN')} skipped`}
                </Text>
                {csvDraft.overCap ? (
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: f.semibold,
                      color: colors.danger,
                    }}
                  >
                    {`A list can hold up to ${MAX_CSV_CONTACTS.toLocaleString('en-IN')} numbers. Split it into smaller broadcasts.`}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Pressable
              onPress={() => {
                haptic.tap();
                setOptedInOnly((v) => !v);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: optedInOnly }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
              }}
            >
              <Ionicons
                name={optedInOnly ? 'checkbox' : 'square-outline'}
                size={20}
                color={optedInOnly ? colors.primary : colors.textFaint}
              />
              <Text style={{ fontSize: 13, color: colors.textMuted }}>
                Only clients who explicitly opted in
                {typeof optedInCount === 'number' ? ` (${optedInCount})` : ''}
              </Text>
            </Pressable>
            <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
              Clients are asked to opt in the first time they message you on
              WhatsApp. Without this, the broadcast goes to everyone except
              contacts who replied STOP ALERTS.
            </Text>

            <SectionLabel
              text="Skip anyone tagged"
              style={{ color: colors.textMuted }}
            />
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.sm,
              }}
            >
              {(tags ?? []).map((tag) => (
                <FilterChip
                  key={tag.id}
                  label={tag.name}
                  active={excludeTagIds.includes(tag.id)}
                  onPress={() =>
                    toggle(excludeTagIds, setExcludeTagIds, tag.id)
                  }
                />
              ))}
            </View>

            <View
              style={[styles.count, { backgroundColor: colors.surfaceSunken }]}
            >
              <Ionicons
                name="people-outline"
                size={16}
                color={colors.primary}
              />
              <Text style={{ flex: 1, fontSize: 13, color: colors.text }}>
                {audienceType === null
                  ? 'Choose who receives it'
                  : audienceType === 'tags' && tagIds.length === 0
                    ? 'Pick at least one tag'
                    : audienceType === 'csv' && audience === null
                      ? csvDraft.overCap
                        ? 'Too many numbers for one broadcast'
                        : 'Paste at least one valid number'
                      : counting
                        ? 'Counting recipients…'
                        : countFailed
                          ? 'Couldn’t count the audience'
                          : `${recipientCount ?? 0} recipient${(recipientCount ?? 0) === 1 ? '' : 's'}`}
              </Text>
              {countFailed && !counting ? (
                <Pressable
                  onPress={() => recount()}
                  accessibilityRole="button"
                  accessibilityLabel="Retry counting recipients"
                  hitSlop={8}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: f.semibold,
                      color: colors.primary,
                    }}
                  >
                    Retry
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={{ gap: spacing.sm }}>
            <SectionLabel text="Preview" style={{ color: colors.textMuted }} />
            <View
              style={[styles.preview, { backgroundColor: colors.primarySoft }]}
            >
              <Text
                style={{ fontSize: 14, lineHeight: 20, color: colors.text }}
              >
                {previewBroadcastUpdate({
                  bodyText: template?.bodyText,
                  message,
                  agencyName: template?.agencyName ?? '',
                  contactName: sample?.name,
                })}
              </Text>
              {template?.footerText ? (
                <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
                  {template.footerText}
                </Text>
              ) : null}
            </View>
            <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
              Shown with a sample contact. Each recipient gets their own values.
            </Text>
          </View>

          <PrimaryButton
            label={
              sending
                ? 'Starting…'
                : messageProblem !== null
                  ? 'Write your message'
                  : audience === null
                    ? 'Choose an audience'
                    : `Send to ${recipientsLabel}`
            }
            onPress={() => void confirmSend()}
            disabled={!ready || sending || confirming}
            busy={sending || confirming}
          />
          <Text
            style={{
              fontSize: 11.5,
              color: colors.textFaint,
              textAlign: 'center',
            }}
          >
            You confirm the recipient count before anything is sent.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
      <AppDialog {...dialog.dialogProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  preview: {
    gap: 6,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  csvInput: {
    minHeight: 120,
    maxHeight: 240,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    textAlignVertical: 'top',
  },
});
