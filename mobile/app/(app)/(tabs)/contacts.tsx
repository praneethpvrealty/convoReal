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

import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import type { Contact } from '@/lib/types';

async function fetchContacts(search: string): Promise<Contact[]> {
  let query = supabase
    .from('contacts')
    .select('id, phone, name, name_tag, classification, avatar_url')
    .order('created_at', { ascending: false })
    .limit(100);
  if (search.trim()) {
    query = query.or(`name.ilike.%${search.trim()}%,phone.ilike.%${search.trim()}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Contact[];
}

export default function ContactsScreen() {
  const [search, setSearch] = useState('');
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['contacts', search],
    queryFn: () => fetchContacts(search),
  });

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search name or phone"
        placeholderTextColor={colors.textMuted}
        value={search}
        onChangeText={setSearch}
      />
      <FlatList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={refetch} />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isFetching ? 'Loading contacts…' : 'No contacts found.'}
          </Text>
        }
        renderItem={({ item }) => <ContactRow contact={item} />}
      />
    </View>
  );
}

function ContactRow({ contact }: { contact: Contact }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {contact.name || contact.phone}
          </Text>
          {contact.name_tag ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{contact.name_tag}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.meta}>
          {[contact.classification, contact.name ? contact.phone : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {/* Native dialer + WhatsApp deep link, per the plan's native integrations */}
      <Pressable
        hitSlop={8}
        onPress={() => Linking.openURL(`tel:${contact.phone}`)}
      >
        <Ionicons name="call-outline" size={22} color={colors.primary} />
      </Pressable>
      <Pressable
        hitSlop={8}
        onPress={() =>
          Linking.openURL(`https://wa.me/${contact.phone.replace(/\D/g, '')}`)
        }
      >
        <Ionicons name="logo-whatsapp" size={22} color={colors.success} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  search: {
    margin: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowBody: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text, flexShrink: 1 },
  tag: {
    backgroundColor: colors.incomingBubble,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tagText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  meta: { fontSize: 13, color: colors.textMuted },
});
