import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Avatar, ConversationSkeleton, EmptyState, Tag } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { classificationColors, radius, spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';

async function fetchContacts(search: string): Promise<Contact[]> {
  let query = supabase
    .from('contacts')
    .select('id, phone, name, name_tag, classification, avatar_url')
    .order('created_at', { ascending: false })
    .limit(150);
  const q = search.trim();
  if (q) {
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Contact[];
}

export default function ContactsScreen() {
  const { colors, dark } = useTheme();
  const [search, setSearch] = useState('');
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['contacts', search],
    queryFn: () => fetchContacts(search),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Contacts</Text>
        <View
          style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Ionicons name="search" size={16} color={colors.textFaint} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search name or phone"
            placeholderTextColor={colors.textFaint}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
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
          data={data ?? []}
          keyExtractor={(c) => c.id}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={search ? 'No matches' : 'No contacts yet'}
              subtitle={
                search
                  ? 'Try a different name or number.'
                  : 'Contacts are created automatically from WhatsApp conversations and portal leads.'
              }
            />
          }
          renderItem={({ item }) => <ContactRow contact={item} dark={dark} />}
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
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Avatar name={name} size={44} />
      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          {contact.name_tag ? <Tag label={contact.name_tag} /> : null}
        </View>
        <View style={styles.metaRow}>
          {contact.classification ? (
            <Text style={{ fontSize: 12.5, fontWeight: '600', color: clsColor ?? colors.textMuted }}>
              {contact.classification}
            </Text>
          ) : null}
          {contact.name ? (
            <Text style={{ fontSize: 12.5, color: colors.textFaint }}>{contact.phone}</Text>
          ) : null}
        </View>
      </View>
      <Pressable
        hitSlop={6}
        onPress={() => Linking.openURL(`tel:${contact.phone}`)}
        style={[styles.action, { backgroundColor: colors.surface }]}
      >
        <Ionicons name="call-outline" size={19} color={colors.primary} />
      </Pressable>
      <Pressable
        hitSlop={6}
        onPress={() => Linking.openURL(`https://wa.me/${contact.phone.replace(/\D/g, '')}`)}
        style={[styles.action, { backgroundColor: colors.surface }]}
      >
        <Ionicons name="logo-whatsapp" size={19} color={colors.success} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: 54, gap: spacing.md, paddingBottom: spacing.md },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 14.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  action: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
