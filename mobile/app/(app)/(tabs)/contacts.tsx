import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/app/(app)/(tabs)/_layout';
import { EnterRow, PressScale } from '@/components/motion';
import { BottomSheet } from '@/components/sheet';
import {
  Avatar,
  Banner,
  ConversationSkeleton,
  EmptyState,
  IconButton,
  PrimaryButton,
  SearchBar,
  SectionLabel,
  Tag,
  TextField,
  listCard,
} from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { cleanPhoneInput } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { classificationColors, radius, shadows, spacing, useTheme , fonts } from '@/lib/theme';
import { useDebounced } from '@/lib/use-debounced';
import { CLASSIFICATIONS, type Classification, type Contact } from '@/lib/types';

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
  const [adding, setAdding] = useState(false);
  // Debounce so multi-step tag/note lookups don't fire per keystroke.
  const debounced = useDebounced(search);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['contacts', debounced],
    queryFn: () => fetchContacts(debounced),
    // Don't wipe the list to skeletons on every keystroke.
    placeholderData: keepPreviousData,
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]}>Contacts</Text>
          <IconButton
            icon="person-add"
            label="Add contact"
            size={22}
            color={colors.primary}
            onPress={() => setAdding(true)}
          />
        </View>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, phone, tag, company…"
        />
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
                  : 'Contacts arrive automatically from WhatsApp conversations and portal leads — or add one with the + button.'
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

      <QuickAddContact visible={adding} onClose={() => setAdding(false)} />
    </View>
  );
}

/**
 * C3 fix: field agents can capture a walk-in without the web app.
 * Uses POST /api/contacts — the same transactional route the web
 * form calls, so plan limits, rate limits and RLS all apply.
 */
function QuickAddContact({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, dark } = useTheme();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [classification, setClassification] = useState<Classification>('Buyer');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setName('');
    setPhone('');
    setClassification('Buyer');
    setError(null);
  }

  async function save() {
    const cleanPhone = cleanPhoneInput(phone);
    if (!cleanPhone) {
      setError('Enter a valid phone number (e.g. 9900277111 or +919900277111)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { id } = await apiFetch<{ id: string }>('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({
          phone: cleanPhone,
          name: name.trim() || null,
          classification,
        }),
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      reset();
      onClose();
      router.push(`/(app)/contact/${id}`);
    } catch (e) {
      haptic.warn();
      setError(friendlyError(e instanceof ApiError ? e.message : 'Could not add the contact'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={() => {
        reset();
        onClose();
      }}
      contentStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
    >
      <Text style={{ fontSize: 17, fontFamily: fonts.extrabold, color: colors.text }}>
        New contact
      </Text>
      {error ? <Banner kind="error" text={error} /> : null}
      <TextField
        placeholder="Name (optional)"
        autoCapitalize="words"
        value={name}
        onChangeText={setName}
      />
      <TextField
        placeholder="Phone · e.g. 99002 77111"
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
      />
      <View style={{ gap: spacing.sm }}>
        <SectionLabel text="Classification" style={{ color: colors.textMuted }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {CLASSIFICATIONS.map((c) => {
            const active = classification === c;
            const hue = classificationColors[c]?.[dark ? 'dark' : 'light'];
            return (
              <Pressable
                key={c}
                onPress={() => setClassification(c)}
                accessibilityRole="button"
                accessibilityLabel={c}
                accessibilityState={{ selected: active }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radius.full,
                  backgroundColor: active ? colors.primarySoft : colors.surface,
                  borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
                  borderColor: active ? colors.primary : colors.border,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: fonts.semibold,
                    color: active ? colors.primary : (hue ?? colors.textMuted),
                  }}
                >
                  {c}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <PrimaryButton
        label="Add contact"
        busy={saving}
        disabled={!phone.trim()}
        onPress={save}
      />
      <Text style={{ fontSize: 11.5, color: colors.textFaint, textAlign: 'center' }}>
        Budgets, notes, tags and more can be added from the contact card.
      </Text>
    </BottomSheet>
  );
}

function ContactRow({ contact, dark }: { contact: Contact; dark: boolean }) {
  const { colors } = useTheme();
  const name = contact.name || contact.phone;
  const clsColor = contact.classification
    ? classificationColors[contact.classification]?.[dark ? 'dark' : 'light']
    : undefined;

  return (
    <PressScale
      onPress={() => router.push(`/(app)/contact/${contact.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Open contact ${name}`}
      contentStyle={StyleSheet.flatten([
        listCard,
        shadows.card,
        { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
      ])}
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
    </PressScale>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 30, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
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
