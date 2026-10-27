import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { StyleSheet, Text, View } from 'react-native';

import { chatListTime, formatBudgetRange } from '@/lib/format';
import { resolveRequirementSource } from '@/lib/requirements-profile';
import { spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';

/**
 * Hold-to-peek capsule: one row-sized pill under the pressed contact
 * with the two crispest lines (budget / areas / tags), a flashlight
 * accent and a real shadow. Near-opaque fill on purpose — a shadow
 * under translucent glass bleeds through as a grey band.
 */
export function ContactPeekCard({
  contact,
  tags,
  propertyCodes = {},
  inset = spacing.lg + 6,
}: {
  contact: Contact;
  tags: string[];
  propertyCodes?: Record<string, string>;
  inset?: number;
}) {
  const { colors, fonts: f } = useTheme();
  const source = resolveRequirementSource(contact);
  // property_interests are category labels, not ids — they read as-is;
  // only last_inquired_property_id resolves to a property code.
  const inquiredCode = source.last_inquired_property_id
    ? propertyCodes[source.last_inquired_property_id]
    : undefined;
  const interests = Array.from(
    new Set(
      [
        ...(source.property_interests ?? []),
        ...(source.pref_property_types ?? []),
        ...(source.pref_property_categories ?? []),
        inquiredCode,
      ].filter((v): v is string => Boolean(v))
    )
  ).slice(0, 2);
  const budget = formatBudgetRange(
    source.min_budget ?? source.pref_budget_min,
    source.max_budget ?? source.pref_budget_max,
    source.no_budget
  );
  const areaHints = Array.from(
    new Set([...(source.areas_of_interest ?? []), ...(source.pref_areas ?? [])])
  );

  const headline =
    [budget ? `Budget ${budget}` : null, contact.company, contact.email]
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ') || 'No preferences captured yet';
  const detail = [
    areaHints.length ? areaHints.slice(0, 2).join(', ') : null,
    ...tags.slice(0, 2),
    ...interests.map((code) => `★ ${code}`),
    contact.last_contacted_at
      ? `Last ${chatListTime(contact.last_contacted_at)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(120)}
      style={[
        styles.peekCapsule,
        { marginHorizontal: inset },
        {
          backgroundColor: colors.surfaceWell,
          borderColor: colors.primary,
          shadowColor: colors.primary,
        },
      ]}
    >
      <View style={[styles.peekTorch, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="flash" size={16} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{ fontSize: 13.5, fontFamily: f.bold, color: colors.text }}
          numberOfLines={1}
        >
          {headline}
        </Text>
        {detail ? (
          <Text
            style={{ fontSize: 12, color: colors.textMuted }}
            numberOfLines={1}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  peekCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: -4,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  peekTorch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
