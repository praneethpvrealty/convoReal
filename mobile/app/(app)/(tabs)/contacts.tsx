import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import * as DeviceContacts from 'expo-contacts';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
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
  FilterChip,
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
import { chatListTime, cleanPhoneInput } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { classificationColors, radius, spacing, useTheme , fonts } from '@/lib/theme';
import { useDebounced } from '@/lib/use-debounced';
import { CLASSIFICATIONS, type Classification, type Contact } from '@/lib/types';

/** Web parity quick filters (contacts-content.tsx). */
const SEGMENTS = [
  { key: 'active', label: 'All' },
  { key: 'pending_review', label: 'Needs Review' },
  { key: 'transacted', label: 'Transacted' },
  { key: 'market_active', label: 'Active Buyers' },
] as const;
type SegmentKey = (typeof SEGMENTS)[number]['key'];

export interface ContactsPage {
  contacts: Contact[];
  /** contact_id → tag names (first few). */
  tags: Record<string, string[]>;
  /** property_id → property_code, for "Interested in" chips. */
  propertyCodes: Record<string, string>;
}

/**
 * Search parity with the web contacts page (contacts-content.tsx):
 * plain terms match name, name_tag, phone, email, company, requirements
 * and classification — PLUS contacts whose TAGS or NOTES match, resolved
 * to ids first (same technique the web uses for notes). Segments follow
 * the web's quick-filter tabs exactly.
 */
async function fetchContacts(search: string, segment: SegmentKey): Promise<ContactsPage> {
  const q = search.trim();
  let query = supabase
    .from('contacts')
    .select(
      'id, phone, name, name_tag, email, company, classification, avatar_url, lead_temp, ' +
        'status, last_contacted_at, last_inquired_property_id, property_interests'
    )
    .order('created_at', { ascending: false })
    .limit(150);

  if (segment === 'active' || segment === 'pending_review') {
    query = query.eq('status', segment);
  } else {
    query = query.eq('status', 'active');
    if (segment === 'transacted') {
      const { data: wonDeals } = await supabase
        .from('deals')
        .select('contact_id')
        .eq('status', 'won');
      const ids = Array.from(new Set((wonDeals ?? []).map((d) => d.contact_id).filter(Boolean)));
      if (ids.length === 0) return { contacts: [], tags: {}, propertyCodes: {} };
      query = query.in('id', ids);
    } else if (segment === 'market_active') {
      query = query.or('lead_temp.eq.HOT,last_inquired_property_id.not.is.null');
    }
  }

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
  const contacts = (data ?? []) as unknown as Contact[];

  // Batch the row decorations: tag chips + interested-property codes.
  const ids = contacts.map((c) => c.id);
  const interestIds = Array.from(
    new Set(
      contacts.flatMap((c) =>
        [...(c.property_interests ?? []), c.last_inquired_property_id].filter(
          (v): v is string => Boolean(v)
        )
      )
    )
  ).slice(0, 100);

  const [tagRows, propRows] = await Promise.all([
    ids.length
      ? supabase
          .from('contact_tags')
          .select('contact_id, tag:tags(name)')
          .in('contact_id', ids)
          .limit(600)
      : Promise.resolve({ data: [] }),
    interestIds.length
      ? supabase.from('properties').select('id, property_code').in('id', interestIds)
      : Promise.resolve({ data: [] }),
  ]);

  const tags: Record<string, string[]> = {};
  for (const row of (tagRows.data ?? []) as { contact_id: string; tag: { name: string } | { name: string }[] | null }[]) {
    const tag = Array.isArray(row.tag) ? row.tag[0] : row.tag;
    if (!tag?.name) continue;
    (tags[row.contact_id] ??= []).push(tag.name);
  }
  const propertyCodes: Record<string, string> = {};
  for (const row of (propRows.data ?? []) as { id: string; property_code: string | null }[]) {
    if (row.property_code) propertyCodes[row.id] = row.property_code;
  }

  return { contacts, tags, propertyCodes };
}

/** Segment counts, same head-count technique as the web tabs. */
async function fetchSegmentCounts(): Promise<Record<SegmentKey, number>> {
  const [active, review, market, wonDeals] = await Promise.all([
    supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_review'),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .or('lead_temp.eq.HOT,last_inquired_property_id.not.is.null'),
    supabase.from('deals').select('contact_id').eq('status', 'won'),
  ]);
  const transacted = new Set(
    (wonDeals.data ?? []).map((d) => d.contact_id).filter(Boolean)
  ).size;
  return {
    active: active.count ?? 0,
    pending_review: review.count ?? 0,
    transacted,
    market_active: market.count ?? 0,
  };
}

export default function ContactsScreen() {
  const { colors, dark, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<SegmentKey>('active');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // Debounce so multi-step tag/note lookups don't fire per keystroke.
  const debounced = useDebounced(search);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['contacts', debounced, segment],
    queryFn: () => fetchContacts(debounced, segment),
    // Don't wipe the list to skeletons on every keystroke.
    placeholderData: keepPreviousData,
  });
  const counts = useQuery({ queryKey: ['contact-counts'], queryFn: fetchSegmentCounts });

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text, fontFamily: f.extrabold }]}>Contacts</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <IconButton
              icon="phone-portrait-outline"
              label="Import from phone"
              size={20}
              color={colors.primary}
              onPress={() => setImporting(true)}
            />
            <IconButton
              icon="person-add"
              label="Add contact"
              size={22}
              color={colors.primary}
              onPress={() => setAdding(true)}
            />
          </View>
        </View>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, phone, tag, company…"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: spacing.sm }}
        >
          {SEGMENTS.map((seg) => {
            const n = counts.data?.[seg.key];
            return (
              <FilterChip
                key={seg.key}
                label={n === undefined ? seg.label : `${seg.label} (${n})`}
                active={segment === seg.key}
                onPress={() => setSegment(seg.key)}
              />
            );
          })}
        </ScrollView>
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
          data={data?.contacts ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingTop: spacing.xs, paddingBottom: TAB_BAR_CLEARANCE }}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={debounced ? 'No matches' : 'Nothing here yet'}
              subtitle={
                debounced
                  ? 'Searched names, phones, tags, notes, company and requirements.'
                  : segment === 'active'
                    ? 'Contacts arrive automatically from WhatsApp conversations and portal leads — or add one with the + button.'
                    : 'No contacts in this segment yet.'
              }
            />
          }
          renderItem={({ item, index }) => (
            <EnterRow index={index}>
              <ContactRow
                contact={item}
                dark={dark}
                tags={data?.tags[item.id] ?? []}
                propertyCodes={data?.propertyCodes ?? {}}
              />
            </EnterRow>
          )}
        />
      )}

      <QuickAddContact visible={adding} onClose={() => setAdding(false)} />
      <DeviceImportSheet visible={importing} onClose={() => setImporting(false)} />
    </View>
  );
}

/**
 * C3 fix: field agents can capture a walk-in without the web app.
 * Uses POST /api/contacts — the same transactional route the web
 * form calls, so plan limits, rate limits and RLS all apply.
 */
function QuickAddContact({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, dark, fonts: f } = useTheme();
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
      <Text style={{ fontSize: 17, fontFamily: f.extrabold, color: colors.text }}>
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
                    fontFamily: f.semibold,
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

/** Tap the chat bubble → jump into the contact's latest conversation
 *  (falls back to plain WhatsApp when no thread exists yet). */
async function openChat(contactId: string, phone: string) {
  haptic.tap();
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.id) router.push(`/(app)/conversation/${data.id}`);
  else Linking.openURL(`https://wa.me/${phone.replace(/\D/g, '')}`);
}

function ContactRow({
  contact,
  dark,
  tags,
  propertyCodes,
}: {
  contact: Contact;
  dark: boolean;
  tags: string[];
  propertyCodes: Record<string, string>;
}) {
  const { colors, fonts: f } = useTheme();
  const name = contact.name || contact.phone;
  const clsColor = contact.classification
    ? classificationColors[contact.classification]?.[dark ? 'dark' : 'light']
    : undefined;
  const interests = Array.from(
    new Set(
      [...(contact.property_interests ?? []), contact.last_inquired_property_id]
        .filter((v): v is string => Boolean(v))
        .map((id) => propertyCodes[id])
        .filter((c): c is string => Boolean(c))
    )
  ).slice(0, 2);

  return (
    <PressScale
      onPress={() => router.push(`/(app)/contact/${contact.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Open contact ${name}`}
      contentStyle={StyleSheet.flatten([
        listCard,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ])}
    >
        <Avatar name={name} size={46} />
        <View style={styles.rowBody}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.text, fontFamily: f.extrabold }]} numberOfLines={1}>
              {name}
            </Text>
            {contact.name_tag ? <Tag label={contact.name_tag} /> : null}
            {contact.last_contacted_at ? (
              <Text style={{ fontSize: 11, color: colors.textFaint, marginLeft: 'auto' }}>
                {chatListTime(contact.last_contacted_at)}
              </Text>
            ) : null}
          </View>
          <View style={styles.metaRow}>
            {contact.classification ? (
              <Tag label={contact.classification} color={clsColor} />
            ) : null}
            {contact.name ? (
              <Text style={{ fontSize: 12.5, color: colors.textFaint }}>{contact.phone}</Text>
            ) : null}
          </View>
          {tags.length > 0 || interests.length > 0 ? (
            <View style={styles.chipRow}>
              {tags.slice(0, 3).map((t) => (
                <Tag key={t} label={t} color={colors.textMuted} />
              ))}
              {interests.map((code) => (
                <Tag key={code} label={`★ ${code}`} color={colors.warning} />
              ))}
            </View>
          ) : null}
        </View>
        <View style={{ gap: 6 }}>
          <Pressable
            hitSlop={8}
            onPress={() => openChat(contact.id, contact.phone)}
            accessibilityRole="button"
            accessibilityLabel={`Open conversation with ${name}`}
            style={[styles.action, { backgroundColor: colors.successSoft }]}
          >
            <Ionicons name="chatbubble-ellipses" size={17} color={colors.success} />
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() => Linking.openURL(`tel:${contact.phone}`)}
            accessibilityRole="button"
            accessibilityLabel={`Call ${name}`}
            style={[styles.action, { backgroundColor: colors.primarySoft }]}
          >
            <Ionicons name="call" size={17} color={colors.primary} />
          </Pressable>
        </View>
    </PressScale>
  );
}

/**
 * "Import from Phone": pick device contacts (expo-contacts) and
 * create them through POST /api/contacts — the same gated route as
 * the web import, so plan limits and RLS apply per contact.
 */
function DeviceImportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, fonts: f } = useTheme();
  const [rows, setRows] = useState<{ key: string; name: string; phone: string }[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setResult(null);
    (async () => {
      const { status } = await DeviceContacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setDenied(true);
        return;
      }
      const { data } = await DeviceContacts.getContactsAsync({
        fields: [DeviceContacts.Fields.PhoneNumbers],
        pageSize: 0,
      });
      const seen = new Set<string>();
      const list: { key: string; name: string; phone: string }[] = [];
      for (const c of data) {
        const phone = c.phoneNumbers?.[0]?.number?.replace(/[^\d+]/g, '');
        if (!phone || phone.replace(/\D/g, '').length < 10) continue;
        if (seen.has(phone)) continue;
        seen.add(phone);
        list.push({ key: c.id ?? phone, name: c.name ?? '', phone });
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      setRows(list);
    })();
  }, [visible]);

  const shown = (rows ?? []).filter(
    (r) =>
      !filter.trim() ||
      r.name.toLowerCase().includes(filter.trim().toLowerCase()) ||
      r.phone.includes(filter.trim())
  );

  function toggle(key: string) {
    haptic.tap();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function importSelected() {
    const picked = (rows ?? []).filter((r) => selected.has(r.key));
    if (picked.length === 0) return;
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const r of picked) {
      try {
        await apiFetch('/api/contacts', {
          method: 'POST',
          body: JSON.stringify({
            phone: cleanPhoneInput(r.phone) ?? r.phone,
            name: r.name || null,
            classification: 'Buyer',
            source: 'phone_import',
          }),
        });
        ok++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    haptic.success();
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['contact-counts'] });
    setResult(
      `Imported ${ok} contact${ok === 1 ? '' : 's'}${failed ? ` · ${failed} failed (duplicates or limits)` : ''}`
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Import from phone"
      contentStyle={{ paddingHorizontal: 0 }}
    >
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        {denied ? (
          <Banner
            kind="error"
            text="Contacts permission denied — allow it in system settings to import."
          />
        ) : null}
        {result ? <Banner kind="success" text={result} /> : null}
        <TextField placeholder="Filter your phone contacts…" value={filter} onChangeText={setFilter} />
      </View>
      <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingVertical: spacing.sm }}>
        {rows === null && !denied ? (
          <Text style={{ textAlign: 'center', padding: spacing.lg, color: colors.textMuted }}>
            Loading phone contacts…
          </Text>
        ) : (
          shown.slice(0, 200).map((r) => {
            const isSel = selected.has(r.key);
            return (
              <Pressable
                key={r.key}
                onPress={() => toggle(r.key)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSel }}
                accessibilityLabel={r.name || r.phone}
                style={[styles.importRow, { borderTopColor: colors.glassBorder }]}
              >
                <Ionicons
                  name={isSel ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={isSel ? colors.primary : colors.textFaint}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: f.semibold, color: colors.text }} numberOfLines={1}>
                    {r.name || r.phone}
                  </Text>
                  {r.name ? (
                    <Text style={{ fontSize: 12, color: colors.textFaint }}>{r.phone}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <PrimaryButton
          label={selected.size > 0 ? `Import ${selected.size} selected` : 'Select contacts to import'}
          busy={busy}
          disabled={selected.size === 0}
          onPress={importSelected}
        />
      </View>
    </BottomSheet>
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
