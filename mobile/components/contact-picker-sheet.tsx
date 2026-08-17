import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { Avatar, SearchBar, Tag, nameTagCap } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';
import { contactHandle } from '@/lib/reachability';

/**
 * Pick Engine contacts by name or phone — the same debounced `contacts`
 * typeahead the new-appointment screen uses, lifted into a reusable
 * sheet. `onSkip` renders an escape row (e.g. "share without a contact");
 * `busy` swaps the list for a spinner while the caller's action runs.
 *
 * With `multiSelect`, rows toggle instead of firing immediately and the
 * caller gets the whole set from `onSelectMany`. Picks are held by id
 * rather than read off the visible rows, so searching again to find the
 * next person does not silently drop the ones already chosen.
 */
export function ContactPickerSheet({
  visible,
  onClose,
  onSelect,
  onSelectMany,
  multiSelect = false,
  confirmLabel = 'Send',
  title = 'Choose a contact',
  hint,
  nudge,
  skipLabel,
  onSkip,
  busy,
  busyLabel,
  searchContacts,
  searchKey,
  initialSelected,
  maxSelections = Number.POSITIVE_INFINITY,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect?: (contact: Contact) => void;
  /** Required when `multiSelect` — receives every picked contact. */
  onSelectMany?: (contacts: Contact[]) => void;
  multiSelect?: boolean;
  confirmLabel?: string;
  title?: string;
  hint?: string;
  /** Secondary suggestion under the hint — e.g. pointing a one-at-a-time
   *  channel at Broadcasts. Tappable when `onPress` is given. */
  nudge?: { icon?: React.ComponentProps<typeof Ionicons>['name']; text: string; onPress?: () => void };
  skipLabel?: string;
  onSkip?: () => void;
  busy?: boolean;
  busyLabel?: string;
  /** Optional server-owned search for surfaces with stricter eligibility
   *  than the general Engine picker (for example Match Radar). */
  searchContacts?: (query: string) => Promise<Contact[]>;
  searchKey?: string;
  initialSelected?: Contact[];
  maxSelections?: number;
}) {
  const { colors, fonts: f } = useTheme();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Contact[]>(initialSelected ?? []);
  const debounced = useDebounced(search.trim());

  useEffect(() => {
    if (!visible) {
      setSearch('');
      setPicked([]);
    }
  }, [visible]);

  function togglePicked(contact: Contact) {
    haptic.tap();
    setPicked((prev) => {
      if (prev.some((p) => p.id === contact.id)) {
        return prev.filter((p) => p.id !== contact.id);
      }
      return prev.length >= maxSelections ? prev : [...prev, contact];
    });
  }

  const { data, isFetching } = useQuery({
    queryKey: ['contact-picker', searchKey ?? 'all', debounced],
    enabled: visible && debounced.length >= 2,
    queryFn: async () => {
      if (searchContacts) {
        return { contacts: await searchContacts(debounced), tags: {} };
      }
      const term = `%${debounced}%`;
      // Digits-only phone match so "+91 97006 06010" finds "+919700606010".
      const digits = debounced.replace(/\D/g, '');
      // name_tag is searchable here for the same reason it is on the
      // Contacts tab: "Bank DSA" is often the only thing the agent
      // remembers about a Nataraj.
      const or =
        digits.length >= 4
          ? `name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term},phone.ilike.%${digits}%`
          : `name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term}`;
      const { data: rows } = await supabase
        .from('contacts')
        .select('id, name, name_tag, phone')
        .eq('is_merged', false)
        .or(or)
        .limit(8);
      const contacts = (rows ?? []) as Contact[];

      // Tag chips for the handful of rows on screen — the same
      // decoration the Contacts tab batches, so a picker row identifies
      // the contact as well as the list does.
      const ids = contacts.map((c) => c.id);
      const tags: Record<string, string[]> = {};
      if (ids.length > 0) {
        const { data: tagRows } = await supabase
          .from('contact_tags')
          .select('contact_id, tag:tags(name)')
          .in('contact_id', ids)
          .limit(80);
        for (const row of (tagRows ?? []) as {
          contact_id: string;
          tag: { name: string } | { name: string }[] | null;
        }[]) {
          const tag = Array.isArray(row.tag) ? row.tag[0] : row.tag;
          if (!tag?.name) continue;
          (tags[row.contact_id] ??= []).push(tag.name);
        }
      }
      return { contacts, tags };
    },
  });
  const results = data?.contacts ?? [];
  const tagsById = data?.tags ?? {};

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md, flexShrink: 1 }}>
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

            {nudge ? (
              <Pressable
                disabled={!nudge.onPress}
                onPress={nudge.onPress}
                accessibilityRole={nudge.onPress ? 'button' : 'text'}
                accessibilityLabel={nudge.text}
                style={[styles.nudge, { backgroundColor: colors.primarySoft }]}
              >
                <Ionicons
                  name={nudge.icon ?? 'megaphone-outline'}
                  size={15}
                  color={colors.primary}
                />
                <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: colors.primary }}>
                  {nudge.text}
                </Text>
                {nudge.onPress ? (
                  <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                ) : null}
              </Pressable>
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

            <View style={{ minHeight: 96, maxHeight: 300, flexShrink: 1 }}>
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
                <ScrollView keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
                  <View style={{ gap: spacing.sm }}>
                    {results.map((c) => {
                      const isPicked = picked.some((p) => p.id === c.id);
                      return (
                      <Pressable
                        key={c.id}
                        disabled={multiSelect && !isPicked && picked.length >= maxSelections}
                        onPress={() => {
                          if (multiSelect) {
                            togglePicked(c);
                            return;
                          }
                          haptic.tap();
                          onSelect?.(c);
                        }}
                        accessibilityRole={multiSelect ? 'checkbox' : 'button'}
                        accessibilityState={multiSelect ? { checked: isPicked } : undefined}
                        accessibilityLabel={c.name || contactHandle(c)}
                        style={[
                          styles.row,
                          { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                          isPicked && { borderColor: colors.primary, backgroundColor: colors.primarySoft },
                          multiSelect && !isPicked && picked.length >= maxSelections && { opacity: 0.45 },
                        ]}
                      >
                        {multiSelect ? (
                          <Ionicons
                            name={isPicked ? 'checkbox' : 'square-outline'}
                            size={20}
                            color={isPicked ? colors.primary : colors.textFaint}
                          />
                        ) : null}
                        <Avatar name={c.name || contactHandle(c)} size={34} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={styles.nameRow}>
                            <Text
                              style={{
                                flexShrink: 1,
                                fontSize: 14.5,
                                fontFamily: f.semibold,
                                color: colors.text,
                              }}
                              numberOfLines={1}
                            >
                              {c.name || c.phone}
                            </Text>
                            {c.name_tag ? (
                              <View style={nameTagCap}>
                                <Tag label={c.name_tag} />
                              </View>
                            ) : null}
                          </View>
                          <View style={styles.metaRow}>
                            {c.name ? (
                              <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
                                {c.phone}
                              </Text>
                            ) : null}
                            {(tagsById[c.id] ?? []).slice(0, 2).map((t) => (
                              <Tag key={t} label={t} />
                            ))}
                          </View>
                        </View>
                        {multiSelect ? null : (
                          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                        )}
                      </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              )}
            </View>

            {/* Picks live above the search box's results, so the count and
                the confirm stay visible while searching for the next one. */}
            {multiSelect ? (
              <Pressable
                disabled={picked.length === 0}
                onPress={() => {
                  haptic.send();
                  onSelectMany?.(picked);
                }}
                accessibilityRole="button"
                accessibilityState={{ disabled: picked.length === 0 }}
                accessibilityLabel={
                  picked.length === 0
                    ? 'Select contacts first'
                    : `${confirmLabel} to ${picked.length} contacts`
                }
                style={[
                  styles.confirm,
                  {
                    backgroundColor: picked.length === 0 ? colors.surfaceSunken : colors.primary,
                  },
                ]}
              >
                <Text
                  style={{
                    fontSize: 14.5,
                    fontFamily: f.bold,
                    color: picked.length === 0 ? colors.textFaint : colors.onPrimary,
                  }}
                >
                  {picked.length === 0
                    ? 'Select contacts'
                    : `${confirmLabel} to ${picked.length} contact${picked.length === 1 ? '' : 's'}`}
                </Text>
              </Pressable>
            ) : null}
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
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  confirm: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: 13,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  hint: {
    fontSize: 12.5,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
