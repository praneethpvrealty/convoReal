import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { apiFetch } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';

interface TagSuggestion {
  tag: string;
  uses: number;
}

/**
 * Web parity: the Tags input on the property form (property-form.tsx).
 * Free-text labels an agent pins on a listing — a builder, a project
 * shorthand, a campaign — searchable through properties.tags_text
 * (migration 192) and never shown on the public showcase.
 *
 * Suggestions come from the tags the account already uses, because a tag
 * only earns its keep if every listing it should cover carries the same
 * spelling: "APM" on three villas of a project and "AMP" on the fourth
 * leaves the fourth out of the search the tag exists for. Tapping is
 * also simply faster than typing on a phone.
 */
export function TagsField({
  tags,
  onChange,
  input,
  onInputChange,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  input: string;
  onInputChange: (next: string) => void;
}) {
  const { colors, fonts: f } = useTheme();

  const { data: suggestions } = useQuery({
    queryKey: ['property-tag-suggestions'],
    queryFn: async () => {
      const { data } = await apiFetch<{ data: TagSuggestion[] }>(
        '/api/properties/tags'
      );
      return data ?? [];
    },
    staleTime: 300_000,
  });

  function add(raw: string) {
    const next = raw.trim();
    // Case-insensitive, so "apm" cannot be added alongside "APM" and
    // split one project's listings across two labels.
    if (!next || tags.some((t) => t.toLowerCase() === next.toLowerCase())) {
      onInputChange('');
      return;
    }
    haptic.tap();
    onChange([...tags, next]);
    onInputChange('');
  }

  const unused = (suggestions ?? [])
    .filter((s) => !tags.some((t) => t.toLowerCase() === s.tag.toLowerCase()))
    .slice(0, 8);

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={[styles.label, { color: colors.textMuted }]}>TAGS</Text>
        <Text style={{ fontSize: 10.5, color: colors.warning }}>
          Engine only — never shown to clients
        </Text>
      </View>

      <View
        style={[
          styles.box,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.glassBorder,
          },
        ]}
      >
        {tags.map((tag) => (
          <View
            key={tag}
            style={[
              styles.chip,
              {
                backgroundColor: colors.primarySoft,
                borderColor: colors.primary,
              },
            ]}
          >
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: f.bold,
                color: colors.primary,
              }}
            >
              {tag}
            </Text>
            <Pressable
              onPress={() => {
                haptic.tap();
                onChange(tags.filter((t) => t !== tag));
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove tag ${tag}`}
            >
              <Ionicons name="close" size={13} color={colors.primary} />
            </Pressable>
          </View>
        ))}
        <TextInput
          value={input}
          onChangeText={onInputChange}
          onSubmitEditing={() => add(input)}
          // A tag typed and left unsubmitted is still a tag the agent
          // meant to add; losing it on blur is the kind of silent
          // discard that makes a field feel broken.
          onBlur={() => add(input)}
          blurOnSubmit={false}
          autoCapitalize="characters"
          placeholder={
            tags.length === 0 ? 'e.g. APM, Distress Sale' : 'Add tag…'
          }
          placeholderTextColor={colors.textFaint}
          style={{
            flex: 1,
            minWidth: 120,
            fontSize: 15,
            color: colors.text,
            paddingVertical: 6,
          }}
        />
      </View>

      {unused.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {unused.map((s) => (
            <Pressable
              key={s.tag}
              onPress={() => add(s.tag)}
              accessibilityRole="button"
              accessibilityLabel={`Add tag ${s.tag}, used on ${s.uses} listings`}
              style={[styles.suggestion, { borderColor: colors.border }]}
            >
              <Ionicons name="add" size={12} color={colors.textMuted} />
              <Text style={{ fontSize: 12, color: colors.textMuted }}>
                {s.tag} · {s.uses}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11.5, letterSpacing: 0.5, fontWeight: '700' },
  box: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    minHeight: 46,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});
