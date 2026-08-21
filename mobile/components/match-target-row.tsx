import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Tag } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * One selectable match row, shared by every surface that offers a
 * ranked target: the property screen's Matching Contacts section and
 * Match Radar's target feed. The two used to draw the same row twice,
 * so a change to how a match reads — the enquiry line, the score
 * colours — landed on one screen and not the other.
 *
 * Web parity: src/components/matching/match-target-row.tsx.
 */
export type MatchTargetTone = 'strong' | 'fair' | 'weak' | 'accent';

export interface MatchTargetChip {
  label: string;
  color?: string;
}

interface MatchTargetRowProps {
  name: string;
  detail?: string | null;
  /** Enquiry labels, newest first — what this contact already asked about. */
  inquiries?: string[];
  scoreLabel: string;
  scoreCaption?: string;
  tone?: MatchTargetTone;
  chips?: MatchTargetChip[];
  /** Classification and name tags, rendered beside the name. */
  badges?: ReactNode;
  selected: boolean;
  onToggle: () => void;
  /** 'avatar' shows initials that double as the checkbox; 'checkbox' a box. */
  indicator?: 'avatar' | 'checkbox';
  initials?: string;
  /** Already-actioned rows recede without becoming unusable. */
  dimmed?: boolean;
  /** Row actions (view, share) on their own line under the details. */
  footer?: ReactNode;
}

export function MatchTargetRow({
  name,
  detail,
  inquiries = [],
  scoreLabel,
  scoreCaption,
  tone = 'weak',
  chips = [],
  badges,
  selected,
  onToggle,
  indicator = 'checkbox',
  initials,
  dimmed = false,
  footer,
}: MatchTargetRowProps) {
  const { colors, fonts: f } = useTheme();
  const toneColor =
    tone === 'strong'
      ? colors.success
      : tone === 'fair'
        ? colors.warning
        : tone === 'accent'
          ? colors.primary
          : colors.textFaint;
  const toneBackground =
    tone === 'strong'
      ? colors.successSoft
      : tone === 'fair'
        ? colors.warningSoft
        : tone === 'accent'
          ? colors.primarySoft
          : colors.glass;

  function toggle() {
    haptic.tap();
    onToggle();
  }

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: selected ? colors.primarySoft : colors.glass,
          borderColor: selected ? colors.primary : colors.glassBorder,
        },
        dimmed && !selected && { opacity: 0.6 },
      ]}
    >
      {indicator === 'avatar' ? (
        <Pressable
          onPress={toggle}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={`Select ${name}`}
          style={[
            styles.avatar,
            {
              backgroundColor: selected ? colors.primary : colors.primarySoft,
              borderColor: selected ? colors.primary : colors.glassBorder,
            },
          ]}
        >
          {selected ? (
            <Ionicons name="checkmark" size={18} color={colors.onPrimary} />
          ) : (
            <Text
              style={{
                fontSize: 12,
                fontFamily: f.extrabold,
                color: colors.primary,
              }}
            >
              {initials}
            </Text>
          )}
        </Pressable>
      ) : (
        <Pressable
          onPress={toggle}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={`Select ${name}`}
        >
          <Ionicons
            name={selected ? 'checkbox' : 'square-outline'}
            size={19}
            color={selected ? colors.primary : colors.textFaint}
          />
        </Pressable>
      )}

      <Pressable
        onPress={toggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`Select ${name}`}
        style={{ flex: 1, gap: 4 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 14.5,
              fontFamily: f.bold,
              color: colors.text,
              flexShrink: 1,
            }}
          >
            {name}
          </Text>
          {badges}
        </View>
        {detail ? (
          <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
            {detail}
          </Text>
        ) : null}
        {inquiries.length > 0 ? (
          <Text
            numberOfLines={1}
            style={{ fontSize: 11.5, color: colors.textFaint }}
          >
            Enquired: {inquiries.join(' · ')}
          </Text>
        ) : null}
        {chips.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {chips.map((chip) => (
              <Tag key={chip.label} label={chip.label} color={chip.color} />
            ))}
          </View>
        ) : null}
      </Pressable>

      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <View
          style={[
            styles.score,
            { backgroundColor: toneBackground, borderColor: toneColor },
          ]}
        >
          <Text
            style={{ fontSize: 11.5, fontFamily: f.extrabold, color: toneColor }}
          >
            {scoreLabel}
          </Text>
        </View>
        {scoreCaption ? (
          <Text style={{ fontSize: 10, color: colors.textFaint }}>
            {scoreCaption}
          </Text>
        ) : null}
      </View>

      {footer ? (
        <View style={[styles.footer, { borderTopColor: colors.glassBorder }]}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  footer: {
    width: '100%',
    flexDirection: 'row',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
});
