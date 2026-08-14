import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { ContactPickerSheet } from '@/components/contact-picker-sheet';
import { BottomSheet } from '@/components/sheet';
import { EmptyState, PrimaryButton, TextField } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';
import { useAppConfig } from '@/lib/use-app-config';
import { usePullRefresh } from '@/lib/use-pull-refresh';

// Mirrors NARRATION_LANGUAGES in src/lib/video/listing-video.ts on the
// web — @shared/ is a types-only alias here, so the list is ported.
// The two must not drift: codes Sarvam bulbul narrates.
const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en-IN', label: 'English' },
  { code: 'hi-IN', label: 'हिन्दी' },
  { code: 'kn-IN', label: 'ಕನ್ನಡ' },
  { code: 'ta-IN', label: 'தமிழ்' },
  { code: 'te-IN', label: 'తెలుగు' },
  { code: 'ml-IN', label: 'മലയാളം' },
  { code: 'mr-IN', label: 'मराठी' },
  { code: 'bn-IN', label: 'বাংলা' },
  { code: 'gu-IN', label: 'ગુજરાતી' },
  { code: 'pa-IN', label: 'ਪੰਜਾਬੀ' },
  { code: 'od-IN', label: 'ଓଡ଼ିଆ' },
];

const TEXT_MAX = 1200;

interface SendCounts {
  audio?: number;
  text?: number;
  video_template?: number;
  skipped_voice_pref?: number;
  skipped_window?: number;
  failed?: number;
}

interface Announcement {
  id: string;
  title: string;
  body_text: string;
  language: string;
  status: 'generating' | 'ready' | 'failed';
  audio_url: string | null;
  error: string | null;
  sent_counts: SendCounts;
  created_at: string;
}

function statusColor(
  status: Announcement['status'],
  colors: ThemeColors
): string {
  switch (status) {
    case 'ready':
      return colors.success;
    case 'failed':
      return colors.danger;
    default:
      return colors.warning;
  }
}

function countsSummary(counts: SendCounts): string | null {
  const parts: string[] = [];
  if (counts.audio) parts.push(`${counts.audio} voice`);
  if (counts.text) parts.push(`${counts.text} text`);
  if (counts.video_template) parts.push(`${counts.video_template} video`);
  if (counts.skipped_window)
    parts.push(`${counts.skipped_window} outside window`);
  if (counts.skipped_voice_pref)
    parts.push(`${counts.skipped_voice_pref} prefer calls`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export default function AnnouncementsScreen() {
  const { colors, fonts: f } = useTheme();
  const dialog = useAppDialog();
  const canManage = useAuthStore((s) => s.profile?.account_role) !== 'viewer';
  const [createOpen, setCreateOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState<Announcement | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['voice-announcements'],
    queryFn: async () =>
      (await apiFetch<{ data: Announcement[] }>('/api/announcements')).data,
    refetchInterval: (query) =>
      query.state.data?.some((a) => a.status === 'generating') ? 5000 : false,
  });
  const pull = usePullRefresh(refetch);

  const sendMutation = useMutation({
    mutationFn: ({
      id,
      contactIds,
      defaultChannel,
    }: {
      id: string;
      contactIds: string[];
      defaultChannel: 'whatsapp_audio' | 'whatsapp_text';
    }) =>
      apiFetch<{ data: { run: SendCounts } }>(`/api/announcements/${id}/send`, {
        method: 'POST',
        body: JSON.stringify({
          contact_ids: contactIds,
          default_channel: defaultChannel,
        }),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['voice-announcements'] });
      dialog.show({
        title: 'Announcement sent',
        message: countsSummary(result.data.run) ?? 'Nothing was sent.',
      });
    },
    onError: (err: Error) =>
      dialog.show({ title: 'Could not send', message: err.message }),
  });

  const pickRecipients = (contacts: { id: string }[]) => {
    const target = sendTarget;
    if (!target || contacts.length === 0) return;
    const contactIds = contacts.map((c) => c.id);
    // Close the picker sheet first — a dialog raised from outside an
    // open sheet renders behind it.
    setSendTarget(null);
    dialog.show({
      title: 'Default delivery',
      message:
        "Used for contacts with no stated preference — a contact's own choice always wins.",
      actions: [
        {
          label: '🎙️ Voice note',
          variant: 'primary',
          onPress: () => {
            dialog.close();
            sendMutation.mutate({
              id: target.id,
              contactIds,
              defaultChannel: 'whatsapp_audio',
            });
          },
        },
        {
          label: '💬 Text',
          onPress: () => {
            dialog.close();
            sendMutation.mutate({
              id: target.id,
              contactIds,
              defaultChannel: 'whatsapp_text',
            });
          },
        },
        { label: 'Cancel', variant: 'muted', onPress: dialog.close },
      ],
    });
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Announcements',
          headerRight: () =>
            canManage ? (
              <Pressable
                onPress={() => setCreateOpen(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="New announcement"
              >
                <Ionicons name="add-circle" size={26} color={colors.primary} />
              </Pressable>
            ) : null,
        }}
      />
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        data={data ?? []}
        keyExtractor={(a) => a.id}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
            Plain announcements rendered to WhatsApp voice notes. Sends respect
            each contact&apos;s channel preference and the 24-hour window.
          </Text>
        }
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              icon="mic-outline"
              title="No announcements yet"
              subtitle="Tap + to write one — it becomes a voice note in the language you pick, ready to send to any contacts."
            />
          )
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.glass,
                borderColor: colors.glassBorder,
              },
            ]}
          >
            <View style={styles.cardTop}>
              <Text
                style={{
                  flex: 1,
                  fontSize: 15,
                  fontFamily: f.bold,
                  color: colors.text,
                }}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              <Text
                style={{
                  fontSize: 11.5,
                  fontFamily: f.bold,
                  textTransform: 'uppercase',
                  color: statusColor(item.status, colors),
                }}
              >
                {item.status}
              </Text>
            </View>
            <Text
              style={{ fontSize: 12.5, color: colors.textMuted }}
              numberOfLines={2}
            >
              {item.body_text}
            </Text>
            <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
              {LANGUAGES.find((l) => l.code === item.language)?.label ??
                item.language}
              {countsSummary(item.sent_counts)
                ? ` · ${countsSummary(item.sent_counts)}`
                : ''}
              {item.status === 'failed' && item.error ? ` · ${item.error}` : ''}
            </Text>
            {item.status === 'ready' && canManage ? (
              <PrimaryButton
                label="Send"
                icon="send"
                busy={sendMutation.isPending}
                onPress={() => setSendTarget(item)}
              />
            ) : null}
          </View>
        )}
      />
      <CreateAnnouncementSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <ContactPickerSheet
        visible={Boolean(sendTarget)}
        onClose={() => setSendTarget(null)}
        multiSelect
        confirmLabel="Choose delivery"
        title={`Send "${sendTarget?.title ?? ''}"`}
        hint="Up to 100 contacts per send. Only contacts inside the 24-hour window receive it."
        onSelectMany={pickRecipients}
        busy={sendMutation.isPending}
        busyLabel="Sending…"
      />
      <AppDialog {...dialog.dialogProps} />
    </View>
  );
}

function CreateAnnouncementSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const dialog = useAppDialog();
  const cost = useAppConfig()?.ai_costs.audio_announcement ?? 5;
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('en-IN');

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ data: { id: string } }>('/api/announcements', {
        method: 'POST',
        body: JSON.stringify({ title, text, language }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice-announcements'] });
      onClose();
      setTitle('');
      setText('');
      dialog.show({
        title: 'Generating voice note',
        message: 'It appears in the list when ready — usually under a minute.',
      });
    },
    onError: (err: Error) =>
      dialog.show({
        title: 'Could not create announcement',
        message: err.message,
      }),
  });

  return (
    <BottomSheet visible={visible} onClose={onClose} title="New announcement">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }}
      >
        <TextField
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="Diwali open-house weekend"
        />
        <TextField
          label="Announcement text"
          value={text}
          onChangeText={(v) => setText(v.slice(0, TEXT_MAX))}
          placeholder="Namaste! This weekend we are hosting an open house at…"
          multiline
        />
        <Text
          style={{
            fontSize: 11,
            color: colors.textFaint,
            textAlign: 'right',
            marginTop: -spacing.sm,
          }}
        >
          {text.length}/{TEXT_MAX}
        </Text>
        <View style={{ gap: spacing.sm }}>
          <Text
            style={{
              fontSize: 12,
              fontFamily: f.semibold,
              color: colors.textMuted,
            }}
          >
            Narration language
          </Text>
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
          >
            {LANGUAGES.map((l) => {
              const active = language === l.code;
              return (
                <Pressable
                  key={l.code}
                  onPress={() => setLanguage(l.code)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: radius.full,
                    backgroundColor: active
                      ? colors.primarySoft
                      : colors.surface,
                    borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
                    borderColor: active ? colors.primary : colors.border,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: f.semibold,
                      color: active ? colors.primary : colors.textMuted,
                    }}
                  >
                    {l.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <Text
          style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}
        >
          Costs {cost} cr per render — refunded automatically if generation
          fails.
        </Text>
        <PrimaryButton
          label="Generate voice note"
          icon="mic-outline"
          disabled={!title.trim() || !text.trim()}
          busy={createMutation.isPending}
          onPress={() => createMutation.mutate()}
        />
      </ScrollView>
      <AppDialog {...dialog.dialogProps} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 8,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});
