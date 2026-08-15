import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { BottomSheet } from '@/components/sheet';
import {
  EmptyState,
  FilterChip,
  PrimaryButton,
  SectionLabel,
  TextField,
} from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import {
  GREETING_MESSAGE_MAX,
  GREETING_TONES,
  buildGreetingAudience,
  canSendGreeting,
  occasionCountdown,
  templateBlockReason,
  type AudienceType,
  type Greeting,
  type GreetingTone,
  type UpcomingOccasion,
} from '@/lib/greetings';
import { queryClient } from '@/lib/query';
import { storagePublicUrl } from '@/lib/storage-url';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useAppConfig } from '@/lib/use-app-config';
import { usePullRefresh } from '@/lib/use-pull-refresh';

interface OccasionOption {
  id: string;
  label: string;
  emoji: string;
}

interface TemplateState {
  status: string | null;
  category: string | null;
  rejectionReason: string | null;
}

interface Tag {
  id: string;
  name: string;
}

export default function GreetingsScreen() {
  const { colors, fonts: f } = useTheme();
  const dialog = useAppDialog();
  const canManage = useAuthStore((s) => s.profile?.account_role) !== 'viewer';
  const [composeOpen, setComposeOpen] = useState(false);
  const [presetOccasion, setPresetOccasion] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Greeting | null>(null);
  const [sendTarget, setSendTarget] = useState<Greeting | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['occasion-greetings'],
    queryFn: async () =>
      (await apiFetch<{ data: Greeting[] }>('/api/greetings')).data,
  });
  const pull = usePullRefresh(refetch);

  const { data: occasions } = useQuery({
    queryKey: ['greeting-occasions'],
    queryFn: async () =>
      (
        await apiFetch<{
          data: { occasions: OccasionOption[]; upcoming: UpcomingOccasion[] };
        }>('/api/greetings/occasions')
      ).data,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/greetings/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['occasion-greetings'] }),
    onError: (err: Error) =>
      dialog.show({ title: 'Could not delete', message: err.message }),
  });

  const confirmDelete = (greeting: Greeting) =>
    dialog.show({
      title: `Delete "${greeting.occasion_label}"?`,
      message: 'The greeting is removed. Messages already sent are unaffected.',
      actions: [
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: () => {
            dialog.close();
            deleteMutation.mutate(greeting.id);
          },
        },
        { label: 'Cancel', variant: 'muted', onPress: dialog.close },
      ],
    });

  const upcoming = occasions?.upcoming.slice(0, 6) ?? [];

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Greetings',
          headerRight: () =>
            canManage ? (
              <Pressable
                onPress={() => {
                  setPresetOccasion(null);
                  setComposeOpen(true);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="New greeting"
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
        keyExtractor={(g) => g.id}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
              Festival greetings written in your agency&apos;s voice and sent to
              your clients with a card image. Contacts who replied STOP ALERTS
              are always excluded.
            </Text>
            {upcoming.length > 0 && canManage ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.sm }}
              >
                {upcoming.map((o) => (
                  <Pressable
                    key={o.id}
                    onPress={() => {
                      setPresetOccasion(o.id);
                      setComposeOpen(true);
                    }}
                    style={[
                      styles.occasionCard,
                      {
                        backgroundColor: colors.glass,
                        borderColor: colors.glassBorder,
                      },
                    ]}
                  >
                    <Text style={{ fontSize: 20 }}>{o.emoji}</Text>
                    <Text
                      style={{
                        fontSize: 13,
                        fontFamily: f.semibold,
                        color: colors.text,
                      }}
                      numberOfLines={1}
                    >
                      {o.label}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.textFaint }}>
                      {occasionCountdown(o.daysUntil)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              icon="sparkles-outline"
              title="No greetings yet"
              subtitle="Pick an occasion above — the AI writes the greeting in your agency's name and designs the card, ready to send."
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
              {item.image_path ? (
                <Image
                  source={{ uri: storagePublicUrl(item.image_path) }}
                  style={styles.thumb}
                />
              ) : null}
              <View style={{ flex: 1, gap: 4 }}>
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
                    {item.occasion_label}
                  </Text>
                  <Text
                    style={{
                      fontSize: 11.5,
                      fontFamily: f.bold,
                      textTransform: 'uppercase',
                      color:
                        item.status === 'sent'
                          ? colors.success
                          : colors.textFaint,
                    }}
                  >
                    {item.status}
                  </Text>
                </View>
                <Text
                  style={{ fontSize: 12.5, color: colors.textMuted }}
                  numberOfLines={3}
                >
                  {item.message_text}
                </Text>
              </View>
            </View>
            {canManage ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    label={item.status === 'sent' ? 'Send again' : 'Send'}
                    icon="send"
                    onPress={() => setSendTarget(item)}
                  />
                </View>
                <Pressable
                  onPress={() => setEditTarget(item)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${item.occasion_label}`}
                  style={{ justifyContent: 'center', paddingHorizontal: 6 }}
                >
                  <Ionicons
                    name="create-outline"
                    size={20}
                    color={colors.textMuted}
                  />
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(item)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${item.occasion_label}`}
                  style={{ justifyContent: 'center', paddingHorizontal: 6 }}
                >
                  <Ionicons
                    name="trash-outline"
                    size={20}
                    color={colors.danger}
                  />
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
      />
      <ComposeGreetingSheet
        visible={composeOpen}
        presetOccasionId={presetOccasion}
        occasions={occasions?.occasions ?? []}
        onClose={() => setComposeOpen(false)}
      />
      <EditGreetingSheet
        greeting={editTarget}
        onClose={() => setEditTarget(null)}
      />
      <SendGreetingSheet
        greeting={sendTarget}
        onClose={() => setSendTarget(null)}
      />
      <AppDialog {...dialog.dialogProps} />
    </View>
  );
}

function ComposeGreetingSheet({
  visible,
  presetOccasionId,
  occasions,
  onClose,
}: {
  visible: boolean;
  presetOccasionId: string | null;
  occasions: OccasionOption[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const dialog = useAppDialog();
  const cost = useAppConfig()?.ai_costs.greetings_generate ?? 10;
  const [occasionId, setOccasionId] = useState<string | null>(null);
  const [tone, setTone] = useState<GreetingTone>('warm');
  const [notes, setNotes] = useState('');
  const [withImage, setWithImage] = useState(true);
  const [message, setMessage] = useState('');
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [lastPreset, setLastPreset] = useState<string | null>(null);

  if (visible && presetOccasionId !== lastPreset) {
    setLastPreset(presetOccasionId);
    if (presetOccasionId) setOccasionId(presetOccasionId);
  }

  const selected = occasions.find((o) => o.id === occasionId);
  const occasionLabel = selected?.label ?? '';

  const reset = () => {
    setMessage('');
    setImagePath(null);
    setImageUrl(null);
    setNotes('');
    setLastPreset(null);
  };

  const generateMutation = useMutation({
    mutationFn: () =>
      apiFetch<{
        data: {
          text: string;
          imagePath: string | null;
          imageUrl: string | null;
        };
      }>('/api/greetings/generate', {
        method: 'POST',
        body: JSON.stringify({
          occasion: occasionLabel,
          tone,
          notes: notes.trim() || undefined,
          generateImage: withImage,
        }),
      }),
    onSuccess: ({ data }) => {
      setMessage(data.text);
      // Always replace, never merge: a second compose with images off —
      // or one whose image failed — would otherwise keep the previous
      // occasion's card and attach it to the new greeting.
      setImagePath(data.imagePath);
      setImageUrl(data.imageUrl);
      if (!data.imagePath && withImage) {
        dialog.show({
          title: 'Card image unavailable',
          message:
            'The greeting text is ready — only the image could not be made.',
        });
      }
    },
    onError: (err: Error) =>
      dialog.show({ title: 'Could not compose', message: err.message }),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ data: Greeting }>('/api/greetings', {
        method: 'POST',
        body: JSON.stringify({
          occasionId,
          occasionLabel,
          messageText: message,
          imagePath: imagePath ?? undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['occasion-greetings'] });
      onClose();
      reset();
    },
    onError: (err: Error) =>
      dialog.show({ title: 'Could not save', message: err.message }),
  });

  return (
    <BottomSheet
      visible={visible}
      onClose={() => {
        onClose();
        reset();
      }}
      title="New greeting"
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }}
      >
        <SectionLabel text="Occasion" style={{ color: colors.textMuted }} />
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          {occasions.map((o) => (
            <FilterChip
              key={o.id}
              label={`${o.emoji} ${o.label}`}
              active={occasionId === o.id}
              onPress={() => setOccasionId(o.id)}
            />
          ))}
        </View>

        <SectionLabel text="Tone" style={{ color: colors.textMuted }} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {GREETING_TONES.map((t) => (
            <FilterChip
              key={t}
              label={t}
              active={tone === t}
              onPress={() => setTone(t)}
            />
          ))}
        </View>

        <TextField
          label="Anything to include? (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. mention that our office is closed on the day"
        />

        <Pressable
          onPress={() => setWithImage((v) => !v)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
          }}
        >
          <Ionicons
            name={withImage ? 'checkbox' : 'square-outline'}
            size={20}
            color={withImage ? colors.primary : colors.textFaint}
          />
          <Text style={{ fontSize: 13, color: colors.textMuted }}>
            Design a festive card image
          </Text>
        </Pressable>

        <PrimaryButton
          label={message ? 'Compose again' : 'Compose with AI'}
          icon="sparkles-outline"
          disabled={!occasionLabel}
          busy={generateMutation.isPending}
          onPress={() => generateMutation.mutate()}
        />

        <TextField
          label="Greeting message"
          value={message}
          onChangeText={(v) => setMessage(v.slice(0, GREETING_MESSAGE_MAX))}
          placeholder="Wishing you and your family a joyous festival…"
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
          {message.length}/{GREETING_MESSAGE_MAX}
        </Text>

        {imageUrl ? (
          <View style={{ alignItems: 'center', gap: spacing.sm }}>
            <Image source={{ uri: imageUrl }} style={styles.preview} />
            <Pressable
              onPress={() => {
                setImagePath(null);
                setImageUrl(null);
              }}
            >
              <Text style={{ fontSize: 12, color: colors.danger }}>
                Remove card
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Text
          style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}
        >
          Composing costs {cost} cr — refunded if the text fails. Writing it
          yourself is free.
        </Text>
        <PrimaryButton
          label="Save greeting"
          icon="save-outline"
          disabled={!occasionLabel || !message.trim()}
          busy={saveMutation.isPending}
          onPress={() => saveMutation.mutate()}
        />
      </ScrollView>
      <AppDialog {...dialog.dialogProps} />
    </BottomSheet>
  );
}

function EditGreetingSheet({
  greeting,
  onClose,
}: {
  greeting: Greeting | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const dialog = useAppDialog();
  const [message, setMessage] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);

  if (greeting && greeting.id !== loadedId) {
    setLoadedId(greeting.id);
    setMessage(greeting.message_text);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ data: Greeting }>(`/api/greetings/${greeting!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ messageText: message }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['occasion-greetings'] });
      setLoadedId(null);
      onClose();
    },
    onError: (err: Error) =>
      dialog.show({ title: 'Could not save', message: err.message }),
  });

  return (
    <BottomSheet
      visible={Boolean(greeting)}
      onClose={() => {
        setLoadedId(null);
        onClose();
      }}
      title={`Edit "${greeting?.occasion_label ?? ''}"`}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }}
      >
        <TextField
          label="Greeting message"
          value={message}
          onChangeText={(v) => setMessage(v.slice(0, GREETING_MESSAGE_MAX))}
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
          {message.length}/{GREETING_MESSAGE_MAX}
        </Text>
        <PrimaryButton
          label="Save changes"
          icon="save-outline"
          disabled={!message.trim()}
          busy={saveMutation.isPending}
          onPress={() => saveMutation.mutate()}
        />
      </ScrollView>
      <AppDialog {...dialog.dialogProps} />
    </BottomSheet>
  );
}

function SendGreetingSheet({
  greeting,
  onClose,
}: {
  greeting: Greeting | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const dialog = useAppDialog();
  const [audienceType, setAudienceType] = useState<AudienceType>('all');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [optedInOnly, setOptedInOnly] = useState(false);

  const { data: template } = useQuery({
    queryKey: ['occasion-greeting-template'],
    queryFn: async () =>
      (await apiFetch<{ data: TemplateState }>('/api/greetings/template')).data,
    enabled: Boolean(greeting),
  });

  const { data: tags } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tags')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Tag[];
    },
    enabled: Boolean(greeting),
  });

  // Counted in SQL (migration 284), not with a client-side
  // count: 'exact' over the account's contacts — see AGENTS.md §2.6.
  const { data: optedInCount } = useQuery({
    queryKey: ['contacts', 'consent-counts'],
    queryFn: async () =>
      (
        await apiFetch<{ data: { granted: number } }>(
          '/api/contacts/consent-counts'
        )
      ).data.granted,
    enabled: Boolean(greeting),
  });

  const setupMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ data: { status: string | null } }>('/api/greetings/template', {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['occasion-greeting-template'],
      });
      dialog.show({
        title: 'Template submitted',
        message:
          'Meta reviews it once — sends unlock as soon as it is approved.',
      });
    },
    onError: (err: Error) =>
      dialog.show({ title: 'Could not submit', message: err.message }),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ data: { broadcastId: string; recipientsCount: number } }>(
        `/api/greetings/${greeting!.id}/send`,
        {
          method: 'POST',
          body: JSON.stringify({
            audience: buildGreetingAudience(audienceType, tagIds),
            optedInOnly,
          }),
        }
      ),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['occasion-greetings'] });
      setTagIds([]);
      onClose();
      dialog.show({
        title: 'Greeting on its way',
        message: `Going out to ${data.recipientsCount} contact${data.recipientsCount === 1 ? '' : 's'}.`,
      });
    },
    onError: (err: Error) =>
      dialog.show({ title: 'Could not send', message: err.message }),
  });

  const blocked = templateBlockReason(
    template?.status ?? null,
    template?.rejectionReason
  );

  return (
    <BottomSheet
      visible={Boolean(greeting)}
      onClose={onClose}
      title={`Send "${greeting?.occasion_label ?? ''}"`}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }}
      >
        {template && blocked ? (
          <View
            style={{
              padding: spacing.md,
              borderRadius: radius.md,
              backgroundColor: colors.warningSoft,
              gap: spacing.sm,
            }}
          >
            <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
              {blocked}
            </Text>
            {template.status === null ? (
              <PrimaryButton
                label="Set up greeting template"
                icon="cloud-upload-outline"
                busy={setupMutation.isPending}
                onPress={() => setupMutation.mutate()}
              />
            ) : null}
          </View>
        ) : null}

        <SectionLabel text="Audience" style={{ color: colors.textMuted }} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <FilterChip
            label="All contacts"
            active={audienceType === 'all'}
            onPress={() => setAudienceType('all')}
          />
          <FilterChip
            label="By tag"
            active={audienceType === 'tags'}
            onPress={() => setAudienceType('tags')}
          />
        </View>
        {audienceType === 'tags' ? (
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
          >
            {(tags ?? []).map((tag) => (
              <FilterChip
                key={tag.id}
                label={tag.name}
                active={tagIds.includes(tag.id)}
                onPress={() =>
                  setTagIds((prev) =>
                    prev.includes(tag.id)
                      ? prev.filter((id) => id !== tag.id)
                      : [...prev, tag.id]
                  )
                }
              />
            ))}
          </View>
        ) : null}

        <Pressable
          onPress={() => setOptedInOnly((v) => !v)}
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
          WhatsApp. Without this, the greeting goes to everyone except contacts
          who replied STOP ALERTS.
        </Text>

        <PrimaryButton
          label="Send greeting"
          icon="send"
          disabled={
            !canSendGreeting(audienceType, tagIds, template?.status ?? null)
          }
          busy={sendMutation.isPending}
          onPress={() => sendMutation.mutate()}
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
    gap: 10,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  occasionCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 2,
    minWidth: 132,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
  },
  preview: {
    width: 140,
    height: 140,
    borderRadius: radius.md,
  },
});
