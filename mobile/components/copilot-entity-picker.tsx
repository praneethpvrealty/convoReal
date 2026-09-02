import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { searchCopilotEntities } from '@/lib/copilot';
import type {
  ActiveCopilotEntityQuery,
  CopilotEntitySuggestion,
} from '@/lib/copilot-entities';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useDebounced } from '@/lib/use-debounced';

interface CopilotEntityPickerProps {
  active: ActiveCopilotEntityQuery;
  onSelect: (entity: CopilotEntitySuggestion) => void;
}

export function CopilotEntityPicker({
  active,
  onSelect,
}: CopilotEntityPickerProps) {
  const { colors, fonts } = useTheme();
  const query = useDebounced(active.query, 220);
  const results = useQuery({
    queryKey: ['copilot-entities', active.symbol, query],
    queryFn: () => searchCopilotEntities(active.symbol, query),
    staleTime: 30_000,
  });
  const title =
    active.symbol === '#'
      ? 'CHOOSE A PROPERTY'
      : active.symbol === '@'
        ? 'CHOOSE A CONTACT'
        : 'CHOOSE A CALENDAR EVENT';

  return (
    <View
      style={[
        styles.picker,
        { backgroundColor: colors.surface, borderTopColor: colors.border },
      ]}
    >
      <Text
        style={[
          styles.title,
          { color: colors.textFaint, fontFamily: fonts.bold },
        ]}
      >
        {title}
      </Text>
      <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
        {results.isPending ? (
          <ActivityIndicator
            color={colors.primary}
            style={styles.loading}
          />
        ) : (results.data ?? []).length === 0 ? (
          <Text style={[styles.empty, { color: colors.textFaint }]}>
            No matching records
          </Text>
        ) : (
          (results.data ?? []).map((entity) => {
            const icon =
              entity.kind === 'property'
                ? 'business-outline'
                : entity.kind === 'contact'
                  ? 'person-outline'
                  : 'calendar-outline';
            return (
              <Pressable
                key={`${entity.kind}:${entity.id}`}
                onPress={() => onSelect(entity)}
                accessibilityRole="button"
                accessibilityLabel={`${entity.symbol}${entity.label}`}
                style={styles.row}
              >
                <View
                  style={[
                    styles.icon,
                    { backgroundColor: colors.primarySoft },
                  ]}
                >
                  <Ionicons name={icon} size={16} color={colors.primary} />
                </View>
                <View style={styles.text}>
                  <Text
                    numberOfLines={1}
                    style={{ color: colors.text, fontFamily: fonts.semibold }}
                  >
                    <Text style={{ color: colors.primary }}>
                      {entity.symbol}
                    </Text>
                    {entity.label}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.subtitle,
                      { color: colors.textMuted, fontFamily: fonts.regular },
                    ]}
                  >
                    {entity.subtitle || 'No additional details'}
                  </Text>
                </View>
                {entity.status ? (
                  <Text
                    style={[
                      styles.status,
                      { color: colors.textFaint, fontFamily: fonts.medium },
                    ]}
                  >
                    {entity.status}
                  </Text>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  title: { fontSize: 10, letterSpacing: 1.1, marginBottom: 4 },
  results: { maxHeight: 220 },
  loading: { paddingVertical: spacing.lg },
  empty: { paddingVertical: spacing.lg, textAlign: 'center', fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  subtitle: { fontSize: 11.5, marginTop: 2 },
  status: { fontSize: 10.5, textTransform: 'capitalize' },
});
