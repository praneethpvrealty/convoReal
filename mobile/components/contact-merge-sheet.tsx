import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ContactPickerSheet } from '@/components/contact-picker-sheet';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { Avatar, Banner, PrimaryButton, Tag } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import {
  mergeContactLabel,
  mergedPhonePreview,
  type MergePreviewContact,
} from '@/lib/contact-merge';
import { rankContactSearchResults } from '@/lib/contact-search-rank';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';

const MERGE_CONTACT_COLUMNS =
  'id, name, name_tag, phone, secondary_phones, email, company, classification, requirements, source, created_at';

export function ContactMergeSheet({
  visible,
  contact,
  onClose,
  onMerged,
}: {
  visible: boolean;
  contact: Contact;
  onClose: () => void;
  onMerged: (targetId: string) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [other, setOther] = useState<Contact | null>(null);
  const [targetId, setTargetId] = useState(contact.id);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (merging) return;
    setOther(null);
    setTargetId(contact.id);
    setError(null);
    onClose();
  }

  async function searchContacts(query: string): Promise<Contact[]> {
    const term = `%${query}%`;
    const digits = query.replace(/\D/g, '');
    const or =
      digits.length >= 4
        ? `name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term},phone.ilike.%${digits}%`
        : `name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term}`;
    const [exactResult, broadResult] = await Promise.all([
      supabase
        .from('contacts')
        .select(MERGE_CONTACT_COLUMNS)
        .eq('is_merged', false)
        .neq('id', contact.id)
        .ilike('name', query)
        .limit(8),
      supabase
        .from('contacts')
        .select(MERGE_CONTACT_COLUMNS)
        .eq('is_merged', false)
        .neq('id', contact.id)
        .or(or)
        .limit(50),
    ]);
    if (exactResult.error) throw exactResult.error;
    if (broadResult.error) throw broadResult.error;
    return rankContactSearchResults(
      [...(exactResult.data ?? []), ...(broadResult.data ?? [])] as Contact[],
      query,
      8
    );
  }

  async function merge() {
    if (!other || merging) return;
    const sourceId = targetId === contact.id ? other.id : contact.id;
    setMerging(true);
    setError(null);
    try {
      const result = await apiFetch<{ success: true; targetId: string }>(
        '/api/contacts/merge',
        {
          method: 'POST',
          body: JSON.stringify({ sourceId, targetId }),
        }
      );
      haptic.success();
      onMerged(result.targetId);
      setOther(null);
    } catch (err) {
      haptic.warn();
      setError(
        friendlyError(err instanceof Error ? err.message : 'Try again.')
      );
    } finally {
      setMerging(false);
    }
  }

  if (!other) {
    return (
      <ContactPickerSheet
        visible={visible}
        onClose={close}
        title="Merge with another contact"
        hint="Search for the other record belonging to this same person."
        searchContacts={searchContacts}
        searchKey={`merge:${contact.id}`}
        onSelect={(selected) => {
          setOther(selected);
          setTargetId(contact.id);
          setError(null);
        }}
      />
    );
  }

  const currentPreview = contact as MergePreviewContact;
  const otherPreview = other as MergePreviewContact;
  const target = targetId === contact.id ? currentPreview : otherPreview;
  const source = targetId === contact.id ? otherPreview : currentPreview;
  const phones = mergedPhonePreview(source, target);

  return (
    <BottomSheet visible={visible} onClose={close} title="Review contact merge">
      <ScrollView
        style={sheetScrollArea}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <Text
            style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}
          >
            Choose the record whose name and primary phone should remain. The
            other record will be hidden after its information is combined.
          </Text>

          {[currentPreview, otherPreview].map((item) => {
            const selected = targetId === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  haptic.tap();
                  setTargetId(item.id);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`Keep ${mergeContactLabel(item)}`}
                style={[
                  styles.contact,
                  {
                    borderColor: selected ? colors.primary : colors.glassBorder,
                    backgroundColor: selected
                      ? colors.primarySoft
                      : colors.glass,
                  },
                ]}
              >
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={21}
                  color={selected ? colors.primary : colors.textFaint}
                />
                <Avatar name={mergeContactLabel(item)} size={38} />
                <View style={styles.contactText}>
                  <View style={styles.nameRow}>
                    <Text
                      numberOfLines={1}
                      style={{
                        flexShrink: 1,
                        color: colors.text,
                        fontFamily: f.bold,
                        fontSize: 15,
                      }}
                    >
                      {mergeContactLabel(item)}
                    </Text>
                    {item.classification ? (
                      <Tag label={item.classification} />
                    ) : null}
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>
                    {item.phone}
                  </Text>
                  {item.email ? (
                    <Text
                      numberOfLines={1}
                      style={{ color: colors.textMuted, fontSize: 12.5 }}
                    >
                      {item.email}
                    </Text>
                  ) : null}
                  {item.company ? (
                    <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>
                      {item.company}
                    </Text>
                  ) : null}
                  {item.requirements ? (
                    <Text
                      numberOfLines={2}
                      style={{ color: colors.textFaint, fontSize: 12 }}
                    >
                      {item.requirements}
                    </Text>
                  ) : null}
                  {selected ? (
                    <Text
                      style={{
                        color: colors.primary,
                        fontFamily: f.semibold,
                        fontSize: 12,
                      }}
                    >
                      Keep this record
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}

          <View
            style={[
              styles.summary,
              {
                backgroundColor: colors.glass,
                borderColor: colors.glassBorder,
              },
            ]}
          >
            <Text
              style={{ color: colors.text, fontFamily: f.bold, fontSize: 13.5 }}
            >
              After merging
            </Text>
            <SummaryRow label="Contact" value={mergeContactLabel(target)} />
            <SummaryRow label="Primary phone" value={phones.primary} />
            {phones.other.length > 0 ? (
              <SummaryRow
                label="Other phones"
                value={phones.other.join(', ')}
              />
            ) : null}
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 12.5,
                lineHeight: 18,
              }}
            >
              Requirements, interested properties, tags, notes and both Inbox
              histories will be combined. Blank profile fields will be filled
              from the other record.
            </Text>
          </View>

          <View style={styles.warning}>
            <Ionicons name="warning-outline" size={17} color={colors.warning} />
            <Text style={{ flex: 1, color: colors.textMuted, fontSize: 12.5 }}>
              Review carefully. This merge cannot be undone from the app.
            </Text>
          </View>

          {error ? <Banner kind="error" text={error} /> : null}
          <PrimaryButton
            label="Merge contacts"
            icon="git-merge-outline"
            busy={merging}
            onPress={merge}
            testID="merge-contacts-confirm"
          />
          <Pressable
            disabled={merging}
            onPress={() => {
              setOther(null);
              setError(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Choose a different contact"
            style={styles.chooseAgain}
          >
            <Text style={{ color: colors.primary, fontFamily: f.semibold }}>
              Choose a different contact
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const { colors, fonts: f } = useTheme();
  return (
    <View style={styles.summaryRow}>
      <Text style={{ color: colors.textFaint, fontSize: 12 }}>{label}</Text>
      <Text
        selectable
        style={{
          flex: 1,
          textAlign: 'right',
          color: colors.text,
          fontFamily: f.semibold,
          fontSize: 12.5,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  contact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  contactText: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  summary: {
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  warning: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chooseAgain: { alignItems: 'center', paddingVertical: spacing.sm },
});
