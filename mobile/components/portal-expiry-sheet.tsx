import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { InlineDateTimePicker } from '@/components/datetime-field';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { Banner, PrimaryButton } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { haptic } from '@/lib/haptics';
import {
  canEditExpiry,
  canMarkRemoved,
  portalRowStatusLabel,
} from '@/lib/portal-drift';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';

interface PortalListingRow {
  id: string;
  portal: '99acres' | 'magicbricks' | 'housing';
  portal_listing_id: string | null;
  expires_on: string | null;
  status: 'active' | 'expired' | 'removed';
}

const PORTAL_LABELS: Record<PortalListingRow['portal'], string> = {
  '99acres': '99acres',
  magicbricks: 'MagicBricks',
  housing: 'Housing.com',
};

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultExpiry(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 90);
  return date;
}

function dateFromKey(value: string | null): Date {
  return value ? new Date(`${value}T12:00:00`) : defaultExpiry();
}

function displayDate(value: string | null): string {
  if (!value) return 'Expiry date missing';
  return dateFromKey(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

async function loadPortalListings(
  accountId: string,
  propertyId: string
): Promise<PortalListingRow[]> {
  const { data, error } = await supabase
    .from('property_portal_listings')
    .select('id, portal, portal_listing_id, expires_on, status')
    .eq('account_id', accountId)
    .eq('property_id', propertyId)
    .order('portal');
  if (error) throw error;
  return (data || []) as PortalListingRow[];
}

export function PortalExpirySheet({
  visible,
  onClose,
  propertyId,
}: {
  visible: boolean;
  onClose: () => void;
  propertyId: string;
}) {
  const { colors, fonts: f } = useTheme();
  const accountId = useAuthStore((state) => state.profile?.account_id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(defaultExpiry);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryKey = ['portal-listings', accountId, propertyId];
  const listings = useQuery({
    queryKey,
    enabled: visible && Boolean(accountId),
    queryFn: () => loadPortalListings(accountId as string, propertyId),
  });

  function edit(row: PortalListingRow) {
    haptic.tap();
    setError(null);
    setEditingId(row.id);
    setDraftDate(dateFromKey(row.expires_on));
    setPickerOpen(true);
  }

  async function save() {
    if (!accountId || !editingId) return;
    setSaving(true);
    setError(null);
    const { data, error: updateError } = await supabase
      .from('property_portal_listings')
      .update({
        expires_on: dateKey(draftDate),
        expiry_reminder_sent: false,
      })
      .eq('id', editingId)
      .eq('account_id', accountId)
      .eq('property_id', propertyId)
      .select('id')
      .maybeSingle();
    setSaving(false);
    if (updateError || !data) {
      haptic.warn();
      setError('Could not save the expiry date. Please try again.');
      return;
    }
    haptic.success();
    setEditingId(null);
    setPickerOpen(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ['portal-drift'] }),
    ]);
  }

  function confirmRemoved(row: PortalListingRow) {
    haptic.tap();
    Alert.alert(
      `Mark ${PORTAL_LABELS[row.portal]} ad removed?`,
      'Use this once the ad is taken down on the portal. ConvoReal stops tracking its expiry.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark removed',
          style: 'destructive',
          onPress: () => void markRemoved(row),
        },
      ]
    );
  }

  async function markRemoved(row: PortalListingRow) {
    if (!accountId) return;
    setRemovingId(row.id);
    setError(null);
    const { data, error: updateError } = await supabase
      .from('property_portal_listings')
      .update({ status: 'removed' })
      .eq('id', row.id)
      .eq('account_id', accountId)
      .eq('property_id', propertyId)
      .select('id')
      .maybeSingle();
    setRemovingId(null);
    if (updateError || !data) {
      haptic.warn();
      setError('Could not mark the ad removed. Please try again.');
      return;
    }
    haptic.success();
    if (editingId === row.id) {
      setEditingId(null);
      setPickerOpen(false);
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ['portal-drift'] }),
    ]);
  }

  function closeSheet() {
    setEditingId(null);
    setPickerOpen(false);
    setError(null);
    onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={closeSheet} title="Portal listings">
      <ScrollView
        style={sheetScrollArea}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>
          ConvoReal tracks each portal separately and reminds you 7, 3 and 1
          days before expiry, on expiry day, and weekly afterwards until the
          listing is renewed or removed.
        </Text>
        {error ? <Banner kind="error" text={error} /> : null}
        {listings.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.textMuted }}>Loading portal ads…</Text>
          </View>
        ) : listings.error ? (
          <Banner
            kind="error"
            text="Could not load the portal listings. Please try again."
          />
        ) : listings.data?.length ? (
          listings.data.map((row) => {
            const editing = editingId === row.id;
            const removed = !canEditExpiry(row);
            const statusLabel = portalRowStatusLabel(row.status);
            return (
              <View
                key={row.id}
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.glass,
                    borderColor:
                      row.expires_on || removed
                        ? colors.glassBorder
                        : colors.warning,
                    opacity: removed ? 0.6 : 1,
                  },
                ]}
              >
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text
                      style={{
                        color: colors.text,
                        fontFamily: f.bold,
                        fontSize: 14,
                      }}
                    >
                      {PORTAL_LABELS[row.portal]}
                      {statusLabel ? ` · ${statusLabel}` : ''}
                    </Text>
                    <Text
                      style={{
                        color:
                          row.expires_on || removed
                            ? colors.textMuted
                            : colors.warning,
                        fontSize: 12.5,
                      }}
                    >
                      {removed && !row.expires_on
                        ? 'No expiry tracked'
                        : displayDate(row.expires_on)}
                      {row.portal_listing_id
                        ? ` · Ad ${row.portal_listing_id}`
                        : ''}
                    </Text>
                  </View>
                  {removed ? null : (
                    <View style={styles.actionColumn}>
                      <Pressable
                        onPress={() => edit(row)}
                        accessibilityRole="button"
                        accessibilityLabel={`Set ${PORTAL_LABELS[row.portal]} expiry date`}
                        style={[
                          styles.editButton,
                          {
                            backgroundColor: colors.primarySoft,
                            borderColor: colors.primary,
                          },
                        ]}
                      >
                        <Ionicons
                          name="calendar-outline"
                          size={15}
                          color={colors.primary}
                        />
                        <Text
                          style={{
                            color: colors.primary,
                            fontFamily: f.bold,
                            fontSize: 12,
                          }}
                        >
                          {row.expires_on ? 'Change' : 'Set date'}
                        </Text>
                      </Pressable>
                      {canMarkRemoved(row) ? (
                        <Pressable
                          onPress={() => confirmRemoved(row)}
                          disabled={removingId === row.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Mark ${PORTAL_LABELS[row.portal]} ad removed`}
                          accessibilityState={{
                            busy: removingId === row.id,
                            disabled: removingId === row.id,
                          }}
                          style={[
                            styles.editButton,
                            { borderColor: colors.danger },
                          ]}
                        >
                          <Ionicons
                            name="trash-outline"
                            size={15}
                            color={colors.danger}
                          />
                          <Text
                            style={{
                              color: colors.danger,
                              fontFamily: f.bold,
                              fontSize: 12,
                            }}
                          >
                            {removingId === row.id
                              ? 'Removing…'
                              : 'Mark removed'}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  )}
                </View>
                {editing && !removed ? (
                  <View style={styles.editor}>
                    <Pressable
                      onPress={() => setPickerOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Choose portal expiry date"
                      style={[
                        styles.dateButton,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.glassBorder,
                        },
                      ]}
                    >
                      <Ionicons
                        name="calendar-clear-outline"
                        size={17}
                        color={colors.primary}
                      />
                      <Text
                        style={{
                          color: colors.text,
                          fontFamily: f.semibold,
                          fontSize: 13,
                        }}
                      >
                        {displayDate(dateKey(draftDate))}
                      </Text>
                    </Pressable>
                    {pickerOpen ? (
                      <InlineDateTimePicker
                        value={draftDate}
                        mode="date"
                        onChange={setDraftDate}
                        onClose={() => setPickerOpen(false)}
                      />
                    ) : null}
                    <PrimaryButton
                      label="Save expiry date"
                      onPress={() => void save()}
                      busy={saving}
                      icon="checkmark-outline"
                    />
                  </View>
                ) : null}
              </View>
            );
          })
        ) : (
          <View
            style={[
              styles.empty,
              {
                backgroundColor: colors.glass,
                borderColor: colors.glassBorder,
              },
            ]}
          >
            <Ionicons name="globe-outline" size={24} color={colors.textFaint} />
            <Text
              style={{
                color: colors.text,
                fontFamily: f.bold,
                fontSize: 14,
              }}
            >
              No portal ads tracked
            </Text>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 12.5,
                lineHeight: 18,
                textAlign: 'center',
              }}
            >
              Posting to portals runs through the Chrome extension on desktop.
              Once an ad is recorded it appears here with its own expiry date.
            </Text>
          </View>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  loading: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  actionColumn: { gap: spacing.sm, alignItems: 'flex-end' },
  editButton: {
    minHeight: 40,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editor: { gap: spacing.sm },
  dateButton: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
});
