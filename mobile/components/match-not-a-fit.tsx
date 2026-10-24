import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { FilterChip } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import {
  markMatchNotAFit,
  restoreMatch,
  saveMatchPropertyType,
  type HiddenPropertyMatch,
} from '@/lib/property-matches';
import { radius, spacing, useTheme } from '@/lib/theme';
import {
  MATCH_REJECT_REASONS,
  STAFF_PROPERTY_TYPE_OPTIONS,
  matchRejectReasonLabel,
  propertyTypeOption,
  type MatchRejectReason,
} from '@shared/lib/match-feedback';

/**
 * Web parity: src/components/inventory/match-not-a-fit.tsx. The reasons,
 * the type list and the rules behind them come from the one shared
 * module; only the rendering is native.
 */

function errorMessage(err: unknown, fallback: string): string {
  return friendlyError(err instanceof ApiError ? err.message : fallback);
}

export function NotAFitPanel({
  propertyId,
  contactId,
  contactName,
  onClose,
  onSaved,
  onError,
}: {
  propertyId: string;
  contactId: string;
  contactName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [reason, setReason] = useState<MatchRejectReason | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function save(chosen: MatchRejectReason, typeIds: string[]) {
    haptic.tap();
    setSaving(true);
    try {
      const { data } = await markMatchNotAFit(
        propertyId,
        contactId,
        chosen,
        typeIds
      );
      onSaved(
        data?.typeSaved
          ? `${contactName} is hidden here, and their property type is saved for future matches.`
          : `${contactName} is hidden from this listing's matches.`
      );
    } catch (err) {
      onError(errorMessage(err, 'Could not save the mark.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View
      style={{
        gap: spacing.sm,
        marginTop: spacing.sm,
        padding: spacing.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.glassBorder,
        backgroundColor: colors.glass,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text
          style={{
            flex: 1,
            fontSize: 12.5,
            fontFamily: f.semibold,
            color: colors.text,
          }}
        >
          {reason === 'type'
            ? `What is ${contactName} looking for?`
            : `Why is this not a fit for ${contactName}?`}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Cancel not a fit"
        >
          <Ionicons name="close" size={16} color={colors.textFaint} />
        </Pressable>
      </View>

      {reason !== 'type' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {MATCH_REJECT_REASONS.map((r) => (
            <FilterChip
              key={r.reason}
              label={r.label}
              active={false}
              onPress={() =>
                saving
                  ? undefined
                  : r.reason === 'type'
                    ? setReason('type')
                    : save(r.reason, [])
              }
            />
          ))}
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {STAFF_PROPERTY_TYPE_OPTIONS.map((o) => {
              const on = types.includes(o.id);
              return (
                <FilterChip
                  key={o.id}
                  label={o.title}
                  active={on}
                  accessibilityLabel={o.description ?? o.title}
                  onPress={() =>
                    setTypes((prev) =>
                      on ? prev.filter((id) => id !== o.id) : [...prev, o.id]
                    )
                  }
                />
              );
            })}
          </View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: spacing.md,
            }}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : null}
            <Pressable
              disabled={saving}
              onPress={() => save('type', [])}
              accessibilityRole="button"
              hitSlop={6}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: f.semibold,
                  color: colors.textMuted,
                }}
              >
                Skip, just hide
              </Text>
            </Pressable>
            <Pressable
              disabled={saving || types.length === 0}
              onPress={() => save('type', types)}
              accessibilityRole="button"
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: 6,
                borderRadius: radius.full,
                backgroundColor: colors.primary,
                opacity: saving || types.length === 0 ? 0.5 : 1,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: f.bold,
                  color: colors.onPrimary,
                }}
              >
                Save type and hide
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

export function TypeSuggestion({
  propertyId,
  contactId,
  optionId,
  canAct,
  onSaved,
  onError,
}: {
  propertyId: string;
  contactId: string;
  optionId: string;
  canAct: boolean;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [saving, setSaving] = useState(false);
  const option = propertyTypeOption(optionId);
  if (!option) return null;

  async function confirm() {
    haptic.tap();
    setSaving(true);
    try {
      await saveMatchPropertyType(propertyId, contactId, [optionId]);
      onSaved(`Property type saved: ${option!.title}.`);
    } catch (err) {
      onError(errorMessage(err, 'Could not save the property type.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginTop: spacing.sm,
        paddingVertical: 6,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.warning,
        backgroundColor: colors.warningSoft,
      }}
    >
      <Ionicons name="sparkles" size={14} color={colors.warning} />
      <Text style={{ flex: 1, fontSize: 11.5, color: colors.text }}>
        Likely looking for{' '}
        <Text style={{ fontFamily: f.bold }}>{option.title}</Text>, from earlier
        &ldquo;Not a fit&rdquo; marks and enquiries
      </Text>
      {canAct ? (
        <Pressable
          disabled={saving}
          onPress={confirm}
          accessibilityRole="button"
          accessibilityLabel={`Confirm ${option.title} as the property type`}
          hitSlop={6}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.warning} />
          ) : (
            <Text
              style={{
                fontSize: 12,
                fontFamily: f.bold,
                color: colors.warning,
              }}
            >
              Confirm
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

export function HiddenMatches({
  propertyId,
  hidden,
  canAct,
  onRestored,
  onError,
}: {
  propertyId: string;
  hidden: HiddenPropertyMatch[];
  canAct: boolean;
  onRestored: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (hidden.length === 0) return null;

  async function restore(contactId: string, name: string) {
    haptic.tap();
    setBusyId(contactId);
    try {
      await restoreMatch(propertyId, contactId);
      onRestored(`${name} is back in this listing's matches.`);
    } catch (err) {
      onError(errorMessage(err, 'Could not restore the contact.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View
      style={{
        borderRadius: radius.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.glassBorder,
      }}
    >
      <Pressable
        onPress={() => {
          haptic.tap();
          setOpen((v) => !v);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          padding: spacing.md,
        }}
      >
        <Ionicons name="eye-off-outline" size={15} color={colors.textMuted} />
        <Text
          style={{
            fontSize: 12.5,
            fontFamily: f.semibold,
            color: colors.textMuted,
          }}
        >
          {open ? 'Hide' : 'Show'} hidden ({hidden.length})
        </Text>
      </Pressable>
      {open
        ? hidden.map(({ contact, feedback }) => {
            const name = contact.name || contact.phone || 'Unnamed contact';
            return (
              <View
                key={contact.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderTopWidth: 1,
                  borderTopColor: colors.glassBorder,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 13,
                      fontFamily: f.semibold,
                      color: colors.text,
                    }}
                  >
                    {name}
                  </Text>
                  <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
                    {matchRejectReasonLabel(feedback.reason)} ·{' '}
                    {feedback.source === 'agent'
                      ? 'marked by agent'
                      : 'said by the buyer'}
                  </Text>
                </View>
                {canAct ? (
                  <Pressable
                    disabled={busyId === contact.id}
                    onPress={() => restore(contact.id, name)}
                    accessibilityRole="button"
                    accessibilityLabel={`Restore ${name}`}
                    hitSlop={6}
                  >
                    {busyId === contact.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Text
                        style={{
                          fontSize: 12,
                          fontFamily: f.bold,
                          color: colors.primary,
                        }}
                      >
                        Restore
                      </Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })
        : null}
    </View>
  );
}
