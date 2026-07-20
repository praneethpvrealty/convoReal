import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { fetchPropertyPage } from '@/app/(app)/(tabs)/properties';
import { BottomSheet } from '@/components/sheet';
import { EmptyState, SearchBar, SectionLabel } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { buildShortlistMessage } from '@/lib/share-message';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Property } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';
import { getShowcaseUrl } from '@/lib/welcome-message';

/**
 * Shortlist a handful of listings and drop them into the current
 * WhatsApp thread. Search the same inventory the Properties tab does,
 * multi-select, then send a numbered "here are your options" message
 * through the CRM number via the parent's send path.
 */
export function PropertyPickerSheet({
  visible,
  onClose,
  onSend,
  sending,
  contactName,
}: {
  visible: boolean;
  onClose: () => void;
  onSend: (text: string) => Promise<boolean>;
  sending: boolean;
  contactName?: string;
}) {
  const { colors, fonts: f } = useTheme();
  const session = useAuthStore((s) => s.session);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Property[]>([]);
  const [message, setMessage] = useState('');
  const [edited, setEdited] = useState(false);
  const debounced = useDebounced(search.trim());

  const { data, isLoading, error } = useQuery({
    queryKey: ['property-picker', debounced],
    enabled: visible,
    queryFn: () => fetchPropertyPage(0, debounced, 'All', null),
  });
  const results = data?.data ?? [];

  const { data: baseUrl } = useQuery({
    queryKey: ['showcase-url'],
    enabled: visible,
    staleTime: 5 * 60_000,
    queryFn: getShowcaseUrl,
  });

  const firstName = (session?.user.email?.split('@')[0] ?? '').split(/[._-]/)[0];
  const agentName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : undefined;
  const agentPhone = session?.user.phone ? `+${session.user.phone.replace(/^\+/, '')}` : undefined;

  const generated = useMemo(() => {
    if (selected.length === 0 || !baseUrl) return '';
    return buildShortlistMessage({
      properties: selected,
      baseUrl,
      contactName,
      agentName,
      agentPhone,
    });
  }, [selected, baseUrl, contactName, agentName, agentPhone]);

  // Re-draft when the selection changes, unless the agent has typed
  // over it (their edits win until they change the shortlist again).
  useEffect(() => {
    if (!edited) setMessage(generated);
  }, [generated, edited]);

  // Reset everything when the sheet is dismissed so it opens clean.
  useEffect(() => {
    if (!visible) {
      setSelected([]);
      setSearch('');
      setMessage('');
      setEdited(false);
    }
  }, [visible]);

  function toggle(property: Property) {
    haptic.tap();
    setEdited(false);
    setSelected((prev) =>
      prev.some((p) => p.id === property.id)
        ? prev.filter((p) => p.id !== property.id)
        : [...prev, property]
    );
  }

  async function send() {
    if (selected.length === 0 || sending || !message.trim()) return;
    haptic.send();
    const ok = await onSend(message.trim());
    if (ok) onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Share properties to chat">
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder='Search inventory — area, type, "2bhk under 80L"'
        />

        <View style={{ maxHeight: 240 }}>
          {isLoading ? (
            <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : error ? (
            <Text style={{ fontSize: 12.5, color: colors.danger, paddingVertical: spacing.md }}>
              Could not load properties — try again.
            </Text>
          ) : results.length === 0 ? (
            <EmptyState
              icon="home-outline"
              title="No matches"
              subtitle="No listings match this search."
            />
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={{ gap: spacing.sm }}>
                {results.map((property) => (
                  <PickerRow
                    key={property.id}
                    property={property}
                    selected={selected.some((p) => p.id === property.id)}
                    onPress={() => toggle(property)}
                  />
                ))}
              </View>
            </ScrollView>
          )}
        </View>

        {selected.length > 0 ? (
          <>
            <SectionLabel text={`Message — ${selected.length} selected · tap to edit`} />
            <TextInput
              multiline
              value={message}
              onChangeText={(t) => {
                setEdited(true);
                setMessage(t);
              }}
              accessibilityLabel="Shortlist message"
              style={[
                styles.draft,
                { backgroundColor: colors.surfaceRaised, borderColor: colors.border, color: colors.text },
              ]}
            />
          </>
        ) : (
          <Text style={{ fontSize: 12.5, color: colors.textMuted, textAlign: 'center' }}>
            Select the listings you want to send — they'll be drafted into one message.
          </Text>
        )}

        <Pressable
          onPress={send}
          disabled={selected.length === 0 || sending}
          accessibilityRole="button"
          accessibilityLabel={`Send ${selected.length} properties to chat`}
          accessibilityState={{ disabled: selected.length === 0 || sending }}
          style={[
            styles.sendButton,
            {
              backgroundColor: colors.primary,
              opacity: selected.length === 0 || sending ? 0.5 : 1,
            },
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Ionicons name="send" size={16} color={colors.onPrimary} />
          )}
          <Text style={{ fontSize: 15, fontFamily: f.bold, color: colors.onPrimary }}>
            {selected.length > 0 ? `Send ${selected.length} to chat` : 'Send to chat'}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

function PickerRow({
  property,
  selected,
  onPress,
}: {
  property: Property;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const cover = property.images?.[0];
  const price =
    property.listing_type === 'Rent'
      ? property.rent_per_month
        ? `${formatInr(property.rent_per_month)}/mo`
        : null
      : property.price
        ? formatInr(property.price)
        : null;
  const place = [property.sublocality, property.city].filter(Boolean).join(', ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={property.title}
      style={[
        styles.row,
        {
          backgroundColor: selected ? colors.primarySoft : colors.glass,
          borderColor: selected ? colors.primary : colors.glassBorder,
        },
      ]}
    >
      {cover ? (
        <Image source={{ uri: cover }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: colors.surfaceSunken }]}>
          <Ionicons name="home-outline" size={18} color={colors.textFaint} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontFamily: f.bold, color: colors.text }} numberOfLines={1}>
          {property.title}
        </Text>
        {place ? (
          <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
            {place}
          </Text>
        ) : null}
        {price ? (
          <Text style={{ fontSize: 13, fontFamily: f.bold, color: colors.primary }}>{price}</Text>
        ) : null}
      </View>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={selected ? colors.primary : colors.textFaint}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 8,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
  },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  draft: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 13.5,
    lineHeight: 19,
    minHeight: 120,
    maxHeight: 200,
    textAlignVertical: 'top',
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.full,
    paddingVertical: 14,
  },
});
