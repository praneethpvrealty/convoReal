import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { PrimaryButton } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * One bottom-sheet picker for both single- and multi-select fields
 * (property type, features, nearby highlights). `groups` renders optional
 * category headers. Single mode closes on pick; multi mode toggles and
 * closes with Done.
 */
export function OptionSheet({
  visible,
  onClose,
  title,
  groups,
  selected,
  onChange,
  multi,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  groups: { group?: string; options: string[] }[];
  selected: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;
}) {
  const { colors, fonts: f } = useTheme();

  function pick(opt: string) {
    haptic.tap();
    if (multi) {
      onChange(selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt]);
    } else {
      onChange([opt]);
      onClose();
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <ScrollView
        style={{ maxHeight: 440 }}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {groups.map((g) => (
          <View key={g.group ?? 'all'}>
            {g.group ? (
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: f.bold,
                  color: colors.textFaint,
                  letterSpacing: 0.5,
                  marginTop: spacing.sm,
                  marginBottom: 4,
                }}
              >
                {g.group.toUpperCase()}
              </Text>
            ) : null}
            {g.options.map((opt) => {
              const active = selected.includes(opt);
              return (
                <Pressable
                  key={opt}
                  onPress={() => pick(opt)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.row,
                    {
                      borderColor: active ? colors.primary : colors.glassBorder,
                      backgroundColor: active ? colors.primarySoft : colors.glass,
                    },
                  ]}
                >
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 14.5,
                      fontFamily: active ? f.bold : f.medium,
                      color: active ? colors.primary : colors.text,
                    }}
                  >
                    {opt}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark" size={18} color={colors.primary} />
                  ) : multi ? (
                    <Ionicons name="ellipse-outline" size={16} color={colors.textFaint} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      {multi ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
          <PrimaryButton label="Done" onPress={onClose} />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    marginBottom: 6,
  },
});
