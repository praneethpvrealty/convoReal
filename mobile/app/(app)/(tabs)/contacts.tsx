import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/app/(app)/(tabs)/_layout';
import { EnterRow } from '@/components/motion';
import { Avatar, ConversationSkeleton, EmptyState, Tag } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { classificationColors, radius, shadows, spacing, useTheme , fonts } from '@/lib/theme';
import type { Contact } from '@/lib/types';

/**
 * Search parity with the web contacts page (contacts-content.tsx):
 * plain terms match name, name_tag, phone, email, company, requirements
 * and classification — PLUS contacts whose TAGS or NOTES match, resolved
 * to ids first (same technique the web uses for notes).
 */
async function fetchContacts(search: string): Promise<Contact[]> {
  const q = search.trim();
  let query = supabase
    .from('contacts')
    .select(
      'id, phone, name, name_tag, email, company, classification, avatar_url, lead_temp'
    )
    .order('created_at', { ascending: false })
    .limit(150);

  if (q) {
    const term = `%${q}%`;

    const [tagResult, noteResult] = await Promise.all([
      supabase.from('tags').select('id').ilike('name', term).limit(25),
      supabase
        .from('contact_notes')
        .select('contact_id')
        .ilike('note_text', term)
        .limit(150),
    ]);

    let tagContactIds: string[] = [];
    const tagIds = (tagResult.data ?? []).map((t: { id: string }) => t.id);
    if (tagIds.length > 0) {
      const { data: taggedRows } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', tagIds)
        .limit(150);
      tagContactIds = (taggedRows ?? []).map((r: { contact_id: string }) => r.contact_id);
    }
    const noteContactIds = (noteResult.data ?? []).map(
      (r: { contact_id: string }) => r.contact_id
    );

    const matchedIds = Array.from(new Set([...tagContactIds, ...noteContactIds])).slice(0, 150);

    let orFilter =
      `name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term},` +
      `email.ilike.${term},company.ilike.${term},requirements.ilike.${term},` +
      `classification.ilike.${term}`;
    if (matchedIds.length > 0) {
      orFilter += `,id.in.(${matchedIds.join(',')})`;
    }
    query = query.or(orFilter);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Contact[];
}

export default function ContactsScreen() {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  // Debounce so multi-step tag/note lookups don't fire per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['contacts', debounced],
    queryFn: () => fetchContacts(debounced),
    // Don't wipe the list to skeletons on every keystroke.
    placeholderData: keepPreviousData,
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={[styles.title, { color: colors.text }]}>Contacts</Text>
        <View
          style={[
            styles.search,
            shadows.soft,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
          ]}
        >
          <Ionicons name="search" size={16} color={colors.textFaint} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search name, phone, tag, company…"
            placeholderTextColor={colors.textFaint}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable
              onPress={() => setSearch('')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={16} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {isLoading ? (
        <View>
          {Array.from({ length: 8 }, (_, i) => (
            <ConversationSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={data ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingTop: spacing.xs, paddingBottom: TAB_BAR_CLEARANCE }}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={debounced ? 'No matches' : 'No contacts yet'}
              subtitle={
                debounced
                  ? 'Searched names, phones, tags, notes, company and requirements.'
                  : 'Contacts are created automatically from WhatsApp conversations and portal leads.'
              }
            />
          }
          renderItem={({ item, index }) => (
            <EnterRow index={index}>
              <ContactRow contact={item} dark={dark} />
            </EnterRow>
          )}
        />
      )}
    </View>
  );
}

function ContactRow({ contact, dark }: { contact: Contact; dark: boolean }) {
  const { colors } = useTheme();
  const name = contact.name || contact.phone;
  const clsColor = contact.classification
    ? classificationColors[contact.classification]?.[dark ? 'dark' : 'light']
    : undefined;

  return (
    <Link href={`/(app)/contact/${contact.id}`} asChild>
      {/* Slot child requires one flat style object (no arrays). */}
      <Pressable
        style={StyleSheet.flatten([
          styles.row,
          shadows.card,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
        ])}
        android_ripple={{ color: colors.background }}
      >
        <Avatar name={name} size={46} />
        <View style={styles.rowBody}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
              {name}
            </Text>
            {contact.name_tag ? <Tag label={contact.name_tag} /> : null}
          </View>
          <View style={styles.metaRow}>
            {contact.classification ? (
              <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: clsColor ?? colors.textMuted }}>
                {contact.classification}
              </Text>
            ) : null}
            {contact.name ? (
              <Text style={{ fontSize: 12.5, color: colors.textFaint }}>{contact.phone}</Text>
            ) : null}
          </View>
        </View>
        <Pressable
          hitSlop={8}
          onPress={() => Linking.openURL(`tel:${contact.phone}`)}
          accessibilityRole="button"
          accessibilityLabel={`Call ${name}`}
          style={[styles.action, { backgroundColor: colors.primarySoft }]}
        >
          <Ionicons name="call" size={18} color={colors.primary} />
        </Pressable>
        <Pressable
          hitSlop={8}
          onPress={() => Linking.openURL(`https://wa.me/${contact.phone.replace(/\D/g, '')}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open WhatsApp chat with ${name}`}
          style={[styles.action, { backgroundColor: colors.successSoft }]}
        >
          <Ionicons name="logo-whatsapp" size={18} color={colors.success} />
        </Pressable>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.md },
  title: { fontSize: 30, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 14.5, fontFamily: fonts.medium },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md - 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 16.5, fontFamily: fonts.extrabold, letterSpacing: -0.2, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  action: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
