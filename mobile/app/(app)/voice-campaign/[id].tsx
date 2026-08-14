import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { ContactPickerSheet } from '@/components/contact-picker-sheet';
import { EmptyState } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';
import { callTimeValueLabel } from '@/lib/time-value';
import { useAppConfig } from '@/lib/use-app-config';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import {
  qualificationLabel,
  recipientContact,
  windowLabel,
  type VoiceCampaignDetail,
  type VoiceRecipient,
} from '@/lib/voice-campaigns';

function recipientColor(status: string, colors: ThemeColors): string {
  switch (status) {
    case 'completed':
      return colors.success;
    case 'calling':
      return colors.primary;
    case 'no_answer':
      return colors.warning;
    case 'failed':
    case 'opted_out':
      return colors.danger;
    default:
      return colors.textMuted;
  }
}

export default function VoiceCampaignDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, fonts: f } = useTheme();
  const dialog = useAppDialog();
  const canManage = useAuthStore((s) => s.profile?.account_role) !== 'viewer';
  const [pickerOpen, setPickerOpen] = useState(false);

  // byo accounts pay their own provider, so the quoted price follows
  // the account's voice mode — same rule as web.
  const costs = useAppConfig()?.ai_costs;
  const { data: voiceConfig } = useQuery({
    queryKey: ['voice-config'],
    queryFn: async () =>
      (await apiFetch<{ data: { mode?: string } | null }>('/api/voice-config'))
        .data,
  });
  const callCost =
    voiceConfig?.mode === 'byo'
      ? (costs?.voice_campaign_call_byo ?? 10)
      : (costs?.voice_campaign_call ?? 250);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['voice-campaign', id],
    enabled: Boolean(id),
    queryFn: async () =>
      (
        await apiFetch<{ data: VoiceCampaignDetail }>(
          `/api/voice-campaigns/${id}`
        )
      ).data,
  });
  const pull = usePullRefresh(refetch);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['voice-campaign', id] });
    queryClient.invalidateQueries({ queryKey: ['voice-campaigns'] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: 'active' | 'paused') =>
      apiFetch(`/api/voice-campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: invalidate,
    onError: (err: Error) =>
      dialog.show({ title: 'Could not update campaign', message: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/voice-campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice-campaigns'] });
      router.back();
    },
    onError: (err: Error) =>
      dialog.show({ title: 'Could not delete campaign', message: err.message }),
  });

  const addMutation = useMutation({
    mutationFn: (contactIds: string[]) =>
      apiFetch<{ data: { added: number } }>(
        `/api/voice-campaigns/${id}/recipients`,
        { method: 'POST', body: JSON.stringify({ contact_ids: contactIds }) }
      ),
    onSuccess: (result) => {
      setPickerOpen(false);
      invalidate();
      dialog.show({
        title: 'Recipients added',
        message: `${result.data.added} contact${result.data.added === 1 ? '' : 's'} added to the campaign.`,
      });
    },
    onError: (err: Error) =>
      dialog.show({ title: 'Could not add recipients', message: err.message }),
  });

  const removeMutation = useMutation({
    mutationFn: (contactId: string) =>
      apiFetch(`/api/voice-campaigns/${id}/recipients`, {
        method: 'DELETE',
        body: JSON.stringify({ contact_ids: [contactId] }),
      }),
    onSuccess: invalidate,
    onError: (err: Error) =>
      dialog.show({
        title: 'Could not remove recipient',
        message: err.message,
      }),
  });

  const confirmDelete = () =>
    dialog.show({
      title: 'Delete this campaign?',
      message:
        'The recipient list and its qualification results are removed. Call journal entries on contacts are kept.',
      actions: [
        { label: 'Cancel', onPress: dialog.close },
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: () => {
            dialog.close();
            deleteMutation.mutate();
          },
        },
      ],
    });

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: data?.name ?? 'Voice campaign',
          headerRight: () =>
            canManage && data ? (
              <Pressable
                onPress={confirmDelete}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Delete campaign"
              >
                <Ionicons
                  name="trash-outline"
                  size={22}
                  color={colors.danger}
                />
              </Pressable>
            ) : null,
        }}
      />
      {isLoading || !data ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          data={data.recipients}
          keyExtractor={(r) => r.id}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
              <View
                style={[
                  styles.summaryCard,
                  {
                    backgroundColor: colors.glass,
                    borderColor: colors.glassBorder,
                  },
                ]}
              >
                <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                  {windowLabel(
                    data.call_window_start_hour,
                    data.call_window_end_hour
                  )}{' '}
                  · up to {data.max_attempts} attempts ·{' '}
                  <Text
                    style={{
                      fontFamily: f.bold,
                      textTransform: 'uppercase',
                      color:
                        data.status === 'active'
                          ? colors.success
                          : data.status === 'paused'
                            ? colors.warning
                            : colors.textMuted,
                    }}
                  >
                    {data.status}
                  </Text>
                </Text>
                {data.script_context.property_title ? (
                  <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                    About: {data.script_context.property_title}
                  </Text>
                ) : null}
                {!data.agent_ref ? (
                  <Text style={{ fontSize: 12, color: colors.warning }}>
                    No voice agent id set — required before starting. Set it
                    from the web for now.
                  </Text>
                ) : null}
              </View>
              {canManage && (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {(data.status === 'draft' || data.status === 'paused') && (
                    <ActionButton
                      icon="play"
                      label="Start"
                      busy={statusMutation.isPending}
                      onPress={() => {
                        // Starting commits the spend, so the trade is
                        // stated here, as on web.
                        const trade = callTimeValueLabel(
                          data.recipients.filter((r) => r.status === 'queued')
                            .length,
                          callCost
                        );
                        if (!trade) {
                          statusMutation.mutate('active');
                          return;
                        }
                        dialog.show({
                          title: `Start "${data.name}"?`,
                          message: trade,
                          actions: [
                            { label: 'Cancel', onPress: dialog.close },
                            {
                              label: 'Start',
                              variant: 'primary',
                              onPress: () => statusMutation.mutate('active'),
                            },
                          ],
                        });
                      }}
                    />
                  )}
                  {data.status === 'active' && (
                    <ActionButton
                      icon="pause"
                      label="Pause"
                      busy={statusMutation.isPending}
                      onPress={() => statusMutation.mutate('paused')}
                    />
                  )}
                  {data.status !== 'completed' && (
                    <ActionButton
                      icon="person-add-outline"
                      label="Add contacts"
                      busy={addMutation.isPending}
                      onPress={() => setPickerOpen(true)}
                    />
                  )}
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title="No recipients yet"
              subtitle="Add contacts, or recreate the campaign from a listing to seed its enquirers."
            />
          }
          renderItem={({ item }) => (
            <RecipientRow
              recipient={item}
              maxAttempts={data.max_attempts}
              canManage={canManage && data.status !== 'completed'}
              onRemove={(contactId) => removeMutation.mutate(contactId)}
            />
          )}
        />
      )}
      <ContactPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        multiSelect
        confirmLabel="Add to campaign"
        title="Add recipients"
        hint="Contacts marked do-not-call or without a phone number are skipped."
        onSelectMany={(contacts) =>
          addMutation.mutate(contacts.map((c) => c.id))
        }
        busy={addMutation.isPending}
        busyLabel="Adding…"
      />
      <AppDialog {...dialog.dialogProps} />
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  busy,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.actionButton,
        {
          backgroundColor: colors.glass,
          borderColor: colors.glassBorder,
          opacity: busy ? 0.6 : 1,
        },
      ]}
      android_ripple={{ color: colors.border }}
    >
      <Ionicons name={icon} size={15} color={colors.primary} />
      <Text
        style={{ fontSize: 13, fontFamily: f.semibold, color: colors.text }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function RecipientRow({
  recipient,
  maxAttempts,
  canManage,
  onRemove,
}: {
  recipient: VoiceRecipient;
  maxAttempts: number;
  canManage: boolean;
  onRemove: (contactId: string) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const contact = recipientContact(recipient);
  const qualification = qualificationLabel(recipient.qualification);

  return (
    <View
      style={[
        styles.recipientRow,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{ fontSize: 14, fontFamily: f.semibold, color: colors.text }}
          numberOfLines={1}
        >
          {contact?.name || 'Unknown'}
        </Text>
        <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
          {contact?.phone ?? '—'} · {recipient.attempts}/{maxAttempts} attempts
        </Text>
        {qualification ? (
          <Text
            style={{
              fontSize: 11.5,
              fontFamily: f.semibold,
              color:
                qualification === 'Qualified'
                  ? colors.success
                  : qualification === 'Do not call'
                    ? colors.danger
                    : colors.warning,
            }}
          >
            {qualification}
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          fontSize: 11,
          fontFamily: f.bold,
          textTransform: 'uppercase',
          color: recipientColor(recipient.status, colors),
        }}
      >
        {recipient.status.replace('_', ' ')}
      </Text>
      {canManage && contact ? (
        <Pressable
          onPress={() => onRemove(contact.id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${contact.name ?? 'contact'} from campaign`}
        >
          <Ionicons
            name="close-circle-outline"
            size={19}
            color={colors.textFaint}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
});
