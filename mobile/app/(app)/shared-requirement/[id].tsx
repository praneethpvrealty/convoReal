import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { EmptyState, PrimaryButton, TextField } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import {
  declineRequirementShare,
  fetchRequirementShare,
  requirementBudget,
  respondToRequirementShare,
  type RequirementShareBox,
  type RequirementShareProperty,
} from '@/lib/requirement-shares';
import { radius, spacing, useTheme } from '@/lib/theme';

export default function SharedRequirementDetailScreen() {
  const params = useLocalSearchParams<{ id: string; box?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const box: RequirementShareBox =
    params.box === 'sent' ? 'sent' : 'received';
  const { colors, fonts: f } = useTheme();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'respond' | 'decline' | null>(null);
  const { show, close, dialogProps } = useAppDialog();

  const detail = useQuery({
    queryKey: ['requirement-account-share', id],
    enabled: Boolean(id),
    queryFn: () => fetchRequirementShare(id),
  });

  useEffect(() => {
    setSelected(detail.data?.responsePropertyIds ?? []);
  }, [detail.data?.responsePropertyIds]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['requirement-account-share', id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['requirement-account-shares'],
      }),
    ]);
  }

  async function respond() {
    if (!id || selected.length === 0 || busy) return;
    setBusy('respond');
    try {
      await respondToRequirementShare(id, selected, note);
      await refresh();
      haptic.success();
      show({
        title: 'Matches sent',
        message:
          'The requesting agent can now review the selected properties from their Sent requirements.',
        actions: [{ label: 'Done', variant: 'primary', onPress: close }],
      });
    } catch (error) {
      haptic.warn();
      show({
        title: 'Could not send matches',
        message: friendlyError(
          error instanceof Error ? error.message : 'Please try again.'
        ),
        actions: [{ label: 'OK', variant: 'primary', onPress: close }],
      });
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    if (!id || busy) return;
    setBusy('decline');
    try {
      await declineRequirementShare(id);
      await refresh();
      haptic.success();
      router.back();
    } catch (error) {
      haptic.warn();
      show({
        title: 'Could not decline',
        message: friendlyError(
          error instanceof Error ? error.message : 'Please try again.'
        ),
        actions: [{ label: 'OK', variant: 'primary', onPress: close }],
      });
    } finally {
      setBusy(null);
    }
  }

  const data = detail.data;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{ title: data?.share.reference || 'Shared requirement' }}
      />
      {detail.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : detail.isError || !data ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Could not open requirement"
          subtitle="It may no longer be available to this account."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.glass, borderColor: colors.glassBorder },
            ]}
          >
            <Text style={{ color: colors.text, fontFamily: f.bold, fontSize: 17 }}>
              {data.share.reference}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              Shared by {[data.share.senderAccountName, data.share.senderName]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {data.share.brief.requirements ? (
              <Text style={{ color: colors.text, lineHeight: 20 }}>
                {data.share.brief.requirements}
              </Text>
            ) : null}
            <Text style={{ color: colors.primary, fontFamily: f.bold }}>
              {requirementBudget(data.share.brief)}
            </Text>
            {data.share.brief.propertyTypes.length ? (
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {data.share.brief.propertyTypes.join(' · ')}
              </Text>
            ) : null}
            {data.share.brief.areas.length ? (
              <View style={styles.inline}>
                <Ionicons name="location-outline" size={15} color={colors.textFaint} />
                <Text style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}>
                  {data.share.brief.areas.join(', ')}
                </Text>
              </View>
            ) : null}
            {data.share.brief.projects.length ? (
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                Projects: {data.share.brief.projects.join(', ')}
              </Text>
            ) : null}
            <Text style={{ color: colors.textFaint, fontSize: 11 }}>
              Buyer identity is hidden from the receiving account.
            </Text>
          </View>

          {box === 'received' ? (
            <>
              <View style={{ gap: spacing.xs }}>
                <Text style={{ color: colors.text, fontFamily: f.bold, fontSize: 16 }}>
                  Select matching inventory
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>
                  Only properties belonging to your account can be returned.
                </Text>
              </View>
              {data.properties.length ? (
                data.properties.map((property) => (
                  <PropertyChoice
                    key={property.id}
                    property={property}
                    checked={selected.includes(property.id)}
                    onPress={() =>
                      setSelected((current) =>
                        current.includes(property.id)
                          ? current.filter((value) => value !== property.id)
                          : [...current, property.id]
                      )
                    }
                  />
                ))
              ) : (
                <EmptyState
                  icon="home-outline"
                  title="No active inventory"
                  subtitle="Add an available property before responding."
                />
              )}
              <TextField
                label="OPTIONAL NOTE"
                value={note}
                onChangeText={setNote}
                placeholder="Add context for the requesting agent"
                multiline
                maxLength={1000}
                style={{ minHeight: 90 }}
              />
              <PrimaryButton
                label={`Send ${selected.length || ''} match${selected.length === 1 ? '' : 'es'}`}
                icon="send-outline"
                busy={busy === 'respond'}
                disabled={selected.length === 0 || busy !== null}
                onPress={respond}
              />
              <Pressable
                accessibilityRole="button"
                disabled={busy !== null}
                onPress={() =>
                  show({
                    title: 'No matching property?',
                    message:
                      'The requesting agent will see that this requirement was declined.',
                    actions: [
                      { label: 'Cancel', onPress: close },
                      {
                        label: 'Decline',
                        variant: 'destructive',
                        onPress: () => {
                          close();
                          void decline();
                        },
                      },
                    ],
                  })
                }
                style={[
                  styles.decline,
                  {
                    borderColor: colors.danger,
                    opacity: busy === null ? 1 : 0.45,
                  },
                ]}
              >
                <Ionicons name="close-outline" size={18} color={colors.danger} />
                <Text style={{ color: colors.danger, fontFamily: f.bold }}>
                  No matching property
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ color: colors.text, fontFamily: f.bold, fontSize: 16 }}>
                Agent response
              </Text>
              {data.responseProperties.length ? (
                data.responseProperties.map((property) => (
                  <PropertyResult key={property.id} property={property} />
                ))
              ) : (
                <EmptyState
                  icon="time-outline"
                  title={
                    data.share.status === 'declined'
                      ? 'No matching property'
                      : 'Waiting for a response'
                  }
                  subtitle={
                    data.share.status === 'declined'
                      ? 'The receiving agent reported no suitable inventory.'
                      : 'Returned properties will appear here.'
                  }
                />
              )}
            </>
          )}
        </ScrollView>
      )}
      <AppDialog {...dialogProps} />
    </View>
  );
}

function PropertyChoice({
  property,
  checked,
  onPress,
}: {
  property: RequirementShareProperty;
  checked: boolean;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={[
        styles.property,
        {
          borderColor: checked ? colors.primary : colors.glassBorder,
          backgroundColor: checked ? colors.primarySoft : colors.glass,
        },
      ]}
    >
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={21}
        color={checked ? colors.primary : colors.textFaint}
      />
      <PropertyText property={property} fontFamily={f.bold} />
    </Pressable>
  );
}

function PropertyResult({ property }: { property: RequirementShareProperty }) {
  const { colors, fonts: f } = useTheme();
  return (
    <View
      style={[
        styles.property,
        {
          borderColor: colors.success,
          backgroundColor: colors.successSoft,
        },
      ]}
    >
      <Ionicons name="checkmark-circle" size={21} color={colors.success} />
      <PropertyText property={property} fontFamily={f.bold} />
    </View>
  );
}

function PropertyText({
  property,
  fontFamily,
}: {
  property: RequirementShareProperty;
  fontFamily: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontFamily }}>
        {property.title}
      </Text>
      <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 11.5 }}>
        {[
          property.location,
          property.price ? formatInr(property.price) : null,
          property.status,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  inline: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  property: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  decline: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
