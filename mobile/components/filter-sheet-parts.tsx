import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SectionLabel } from '@/components/ui';
import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * The chip vocabulary shared by the Contacts and Properties filter
 * sheets, so the two read as one control rather than two that drifted.
 *
 * Metrics match the classification pills on the new-contact sheet.
 * Ordered scales (a money ladder) scroll in `PillScroller`; unordered
 * sets wrap in `PillWrap`.
 */
export function FilterGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text={label} style={{ color: colors.textMuted }} />
      {children}
      {hint ? (
        <Text style={{ fontSize: 11, color: colors.textFaint }}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function PillWrap({ children }: { children: React.ReactNode }) {
  return <View style={styles.wrap}>{children}</View>;
}

export function PillScroller({ children }: { children: React.ReactNode }) {
  const { dark } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      indicatorStyle={dark ? 'white' : 'black'}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xs }}
    >
      {children}
    </ScrollView>
  );
}

export function FilterPill({
  label,
  tint,
  active,
  onPress,
}: {
  label: string;
  /** Category colour for an unselected pill (e.g. classification hues). */
  tint?: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radius.full,
        backgroundColor: active ? colors.primarySoft : colors.surface,
        borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
        borderColor: active ? colors.primary : colors.border,
        maxWidth: 220,
      }}
    >
      <Text
        style={{
          fontSize: 13,
          fontFamily: f.semibold,
          color: active ? colors.primary : (tint ?? colors.textMuted),
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
