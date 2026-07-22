import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { Avatar, SearchBar } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';

/**
 * Pick one CRM contact by name or phone — the same debounced `contacts`
 * typeahead the new-appointment screen uses, lifted into a reusable
 * sheet. `onSkip` renders an escape row (e.g. "share without a contact");
 * `busy` swaps the list for a spinner while the caller's action runs.
 */
export function ContactPickerSheet({
  visible,
  onClose,
  onSelect,
  title = 'Choose a contact',
  hint,
  skipLabel,
  onSkip,
  busy,
  busyLabel,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (contact: Contact) => void;
  title?: string;
  hint?: string;
  skipLabel?: string;
  onSkip?: () => void;
  busy?: boolean;
  busyLabel?: string;
}) {
  const { colors, fonts: f } = useTheme();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim());

  useEffect(() => {
    if (!visible) setSearch('');
  }, [visible]);

  const { data: contacts, isFetching } = useQuery({
    queryKey: ['contact-picker', debounced],
    enabled: visible && debounced.length >= 2,
    queryFn: async () => {
      const term = `%${debounced}%`;
      // Digits-only phone match so "+91 97006 06010" finds "+919700606010".
      const digits = debounced.replace(/\D/g, '');
      const or =
        digits.length >= 4
          ? `name.ilike.${term},phone.ilike.${term},phone.ilike.%${digits}%`
          : `name.ilike.${term},phone.ilike.${term}`;
      const { data } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .or(or)
        .limit(8);
      return (data ?? []) as Contact[];
    },
  });
  const results = contacts ?? [];

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
        {busy ? (
          <View style={{ paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.md }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ fontSize: 13, color: colors.textMuted }}>{busyLabel ?? 'Sending…'}</Text>
          </View>
        ) : (
          <>
            {hint ? (
              <Text style={{ fontSize: 12.5, color: colors.textMuted }}>{hint}</Text>
            ) : null}

            {onSkip ? (
              <Pressable
                onPress={onSkip}
                accessibilityRole="button"
                accessibilityLabel={skipLabel ?? 'Continue without a contact'}
                style={[styles.skip, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
              >
                <Ionicons name="logo-whatsapp" size={17} color={colors.success} />
                <Text style={{ flex: 1, fontSize: 13.5, fontFamily: f.semibold, color: colors.text }}>
                  {skipLabel ?? 'Continue without a contact'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </Pressable>
            ) : null}

            <SearchBar
              value={search}
              onChangeText={setSearch}
              placeholder="Search name or phone"
              autoFocus
            />

            <View style={{ minHeight: 96, maxHeight: 300 }}>
              {debounced.length < 2 ? (
                <Text style={[styles.hint, { color: colors.textFaint }]}>
                  Type at least 2 characters to search your contacts.
                </Text>
              ) : isFetching ? (
                <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : results.length === 0 ? (
                <Text style={[styles.hint, { color: colors.textFaint }]}>
                  No contacts match “{debounced}”.
                </Text>
              ) : (
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <View style={{ gap: spacing.sm }}>
                    {results.map((c) => (
                      <Pressable
                        key={c.id}
                        onPress={() => {
                          haptic.tap();
                          onSelect(c);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={c.name || c.phone}
                        style={[styles.row, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
                      >
                        <Avatar name={c.name || c.phone} size={34} />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{ fontSize: 14.5, fontFamily: f.semibold, color: colors.text }}
                            numberOfLines={1}
                          >
                            {c.name || c.phone}
                          </Text>
                          {c.name ? (
                            <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
                              {c.phone}
                            </Text>
                          ) : null}
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              )}
            </View>
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  skip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 8,
  },
  hint: {
    fontSize: 12.5,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
