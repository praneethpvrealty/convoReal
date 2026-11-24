import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError, apiFetch } from '@/lib/api';
import {
  dealOptionDetail,
  fetchDealsForEvent,
  searchDeals,
  type DealOption,
} from '@/lib/deal-link';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Appointment } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';

/**
 * The deal a calendar event belongs to: open it, unlink it, connect
 * the event to an existing deal, or start a new deal from the event's
 * contacts and property. Web parity: event-deal-link.tsx.
 */
export function EventDealLink({
  appointment,
  canEdit,
  onNavigate,
}: {
  appointment: Appointment;
  canEdit: boolean;
  onNavigate: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [override, setOverride] = useState<
    { id: string; title: string } | null | undefined
  >(undefined);
  const deal = override === undefined ? (appointment.deal ?? null) : override;
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useQuery({
    queryKey: ['event-deal-suggestions', appointment.id],
    enabled: picking,
    queryFn: () => fetchDealsForEvent(appointment),
  });
  const results = useQuery({
    queryKey: ['event-deal-search', debouncedSearch],
    enabled: picking && debouncedSearch.trim().length >= 2,
    queryFn: () => searchDeals(debouncedSearch),
  });
  const searching = debouncedSearch.trim().length >= 2;
  const options = searching ? (results.data ?? []) : (suggestions.data ?? []);
  const loading = searching ? results.isLoading : suggestions.isLoading;

  async function link(next: DealOption | null) {
    haptic.tap();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/appointments/${appointment.id}`, {
        method: 'PUT',
        body: JSON.stringify({ deal_id: next?.id ?? null }),
      });
      haptic.success();
      setOverride(next ? { id: next.id, title: next.title } : null);
      setPicking(false);
      setSearch('');
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    } catch (err) {
      haptic.warn();
      setError(
        err instanceof ApiError
          ? err.message
          : next
            ? 'Could not connect this event to the deal.'
            : 'Could not disconnect the deal.'
      );
    } finally {
      setBusy(false);
    }
  }

  if (deal) {
    return (
      <View style={{ gap: 4 }}>
        <View style={styles.row}>
          <Pressable
            style={[styles.row, { flex: 1 }]}
            accessibilityRole="link"
            accessibilityLabel={`Open deal ${deal.title}`}
            onPress={() => {
              onNavigate();
              router.push(`/(app)/deal/${deal.id}`);
            }}
          >
            <Ionicons
              name="briefcase-outline"
              size={16}
              color={colors.primary}
            />
            <Text
              style={{
                flex: 1,
                fontSize: 14,
                lineHeight: 20,
                fontFamily: f.semibold,
                color: colors.primary,
              }}
            >
              Deal: {deal.title}
            </Text>
          </Pressable>
          {canEdit ? (
            <Pressable
              onPress={() => void link(null)}
              disabled={busy}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Disconnect this event from the deal"
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.textMuted} />
              ) : (
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={colors.textFaint}
                />
              )}
            </Pressable>
          ) : null}
        </View>
        {error ? (
          <Text style={{ fontSize: 12.5, color: colors.danger }}>{error}</Text>
        ) : null}
      </View>
    );
  }

  if (!canEdit) return null;

  if (!picking) {
    return (
      <Pressable
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel="Connect this event to a deal"
        onPress={() => {
          haptic.tap();
          setPicking(true);
        }}
      >
        <Ionicons name="briefcase-outline" size={16} color={colors.primary} />
        <Text
          style={{
            fontSize: 14,
            fontFamily: f.semibold,
            color: colors.primary,
          }}
        >
          Connect to a deal
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.row}>
        <Text
          style={{
            flex: 1,
            fontSize: 11.5,
            fontFamily: f.bold,
            color: colors.textMuted,
          }}
        >
          CONNECT TO A DEAL
        </Text>
        <Pressable
          onPress={() => {
            setPicking(false);
            setSearch('');
            setError(null);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Cancel connecting a deal"
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      <Pressable
        style={[styles.create, { backgroundColor: colors.primary }]}
        accessibilityRole="button"
        accessibilityLabel="Create a new deal from this event"
        onPress={() => {
          haptic.tap();
          onNavigate();
          router.push({
            pathname: '/(app)/deal-edit',
            params: { appointmentId: appointment.id },
          });
        }}
      >
        <Ionicons name="add" size={17} color={colors.onPrimary} />
        <Text
          style={{
            fontSize: 13.5,
            fontFamily: f.bold,
            color: colors.onPrimary,
          }}
        >
          Create a new deal from this event
        </Text>
      </Pressable>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>
        Starts with this event&apos;s contacts and property. Or pick an existing
        deal:
      </Text>

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search deals by title"
        placeholderTextColor={colors.textFaint}
        accessibilityLabel="Search deals"
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceWell,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
      />

      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : options.length === 0 ? (
        <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
          {searching
            ? 'No deal matches that search.'
            : 'No deal yet with this property or these contacts. Search by title, or create one.'}
        </Text>
      ) : (
        options.map((option) => (
          <Pressable
            key={option.id}
            disabled={busy}
            onPress={() => void link(option)}
            accessibilityRole="button"
            accessibilityLabel={`Connect to deal ${option.title}`}
            style={[
              styles.option,
              {
                backgroundColor: colors.surfaceWell,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons
              name="briefcase-outline"
              size={16}
              color={colors.primary}
            />
            <View style={{ flex: 1, gap: 1 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: f.semibold,
                  color: colors.text,
                }}
                numberOfLines={1}
              >
                {option.title}
              </Text>
              {dealOptionDetail(option) ? (
                <Text
                  style={{ fontSize: 12, color: colors.textFaint }}
                  numberOfLines={1}
                >
                  {dealOptionDetail(option)}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))
      )}
      {error ? (
        <Text style={{ fontSize: 12.5, color: colors.danger }}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  panel: {
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  create: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
    paddingVertical: 10,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontSize: 14,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
});
