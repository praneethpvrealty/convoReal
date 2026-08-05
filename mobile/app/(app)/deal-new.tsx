import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { InlineDateTimePicker } from '@/components/datetime-field';
import {
  Avatar,
  Banner,
  FilterChip,
  PriceHint,
  PrimaryButton,
  Tag,
  TextField,
} from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact, Deal, PipelineStage } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';

/**
 * Web parity: the deal form's create path (deal-form.tsx →
 * POST /api/deals, which also syncs the linked property's status off
 * the stage name). Assignment, brokerage and non-INR currencies stay
 * on the web's fuller form.
 */

/** Same status derivation the web form applies on save. */
function statusForStage(stageName: string): Deal['status'] {
  const n = stageName.toLowerCase();
  if (n.includes('lost')) return 'lost';
  if (n.includes('won')) return 'won';
  return 'open';
}

function localDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

interface PropertyOption {
  id: string;
  title: string;
  property_code: string | null;
  location: string | null;
  sublocality: string | null;
}

export default function NewDealScreen() {
  const { colors, fonts: f } = useTheme();
  const params = useLocalSearchParams<{
    pipelineId?: string;
    stageId?: string;
  }>();
  const pipelineId = params.pipelineId ?? null;

  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [stageId, setStageId] = useState<string | null>(params.stageId ?? null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [property, setProperty] = useState<PropertyOption | null>(null);
  const [propertySearch, setPropertySearch] = useState('');
  const [closeDate, setCloseDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedContactSearch = useDebounced(contactSearch);
  const debouncedPropertySearch = useDebounced(propertySearch);

  const { data: stages } = useQuery({
    queryKey: ['pipeline-stages', pipelineId],
    enabled: Boolean(pipelineId),
    queryFn: async () => {
      const { data, error: stageError } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId!)
        .order('position');
      if (stageError) throw stageError;
      return (data ?? []) as PipelineStage[];
    },
  });
  const activeStageId = stageId ?? stages?.[0]?.id ?? null;

  const { data: contactOptions } = useQuery({
    queryKey: ['contact-picker', debouncedContactSearch],
    enabled: debouncedContactSearch.trim().length >= 2 && !contact,
    queryFn: async () => {
      const term = `%${debouncedContactSearch.trim()}%`;
      const { data } = await supabase
        .from('contacts')
        .select('id, name, name_tag, phone')
        .or(`name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term}`)
        .limit(6);
      return (data ?? []) as Contact[];
    },
  });

  const { data: propertyOptions } = useQuery({
    queryKey: ['deal-property-picker', debouncedPropertySearch],
    enabled: debouncedPropertySearch.trim().length >= 2 && !property,
    queryFn: async () => {
      const term = `%${debouncedPropertySearch.trim()}%`;
      const { data } = await supabase
        .from('properties')
        .select('id, title, property_code, location, sublocality')
        .or(
          `title.ilike.${term},property_code.ilike.${term},location.ilike.${term}`
        )
        .limit(6);
      return (data ?? []) as PropertyOption[];
    },
  });

  async function save() {
    const selectedStage = (stages ?? []).find((s) => s.id === activeStageId);
    if (!title.trim() || !contact || !pipelineId || !selectedStage) return;
    haptic.tap();
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/api/deals', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          value: parseFloat(value) || 0,
          currency: 'INR',
          contact_id: contact.id,
          pipeline_id: pipelineId,
          stage_id: selectedStage.id,
          notes: notes.trim() || null,
          expected_close_date: closeDate ? localDateString(closeDate) : null,
          property_id: property?.id ?? null,
          status: statusForStage(selectedStage.name),
          stage_name: selectedStage.name,
        }),
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      router.back();
    } catch (err) {
      haptic.warn();
      setError(
        err instanceof ApiError ? err.message : 'Could not create the deal.'
      );
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ headerShown: true, title: 'New deal' }} />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {error ? <Banner kind="error" text={error} /> : null}

        <TextField
          placeholder="Deal title · e.g. 3BHK Prestige Lakeview — Ravi"
          value={title}
          onChangeText={setTitle}
        />

        <TextField
          placeholder="Deal value (₹)"
          keyboardType="numeric"
          value={value}
          onChangeText={setValue}
        />
        <PriceHint value={value} />

        {contact ? (
          <SelectedRow
            label={contact.name || contact.phone}
            nameTag={contact.name_tag}
            avatar
            onClear={() => setContact(null)}
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            <TextField
              placeholder="Contact — search name or phone (required)"
              value={contactSearch}
              onChangeText={setContactSearch}
            />
            {(contactOptions ?? []).map((c) => (
              <Pressable
                key={c.id}
                style={[
                  styles.optionRow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => {
                  haptic.tap();
                  setContact(c);
                  setContactSearch('');
                }}
              >
                <Avatar name={c.name || c.phone} size={30} />
                <Text
                  style={{ flexShrink: 1, fontSize: 14.5, color: colors.text }}
                  numberOfLines={1}
                >
                  {c.name || c.phone}
                </Text>
                {c.name_tag ? <Tag label={c.name_tag} /> : null}
              </Pressable>
            ))}
          </View>
        )}

        {property ? (
          <SelectedRow
            label={property.title}
            detail={property.sublocality || property.location}
            icon="home-outline"
            onClear={() => setProperty(null)}
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            <TextField
              placeholder="Link a property — search title or code (optional)"
              value={propertySearch}
              onChangeText={setPropertySearch}
            />
            {(propertyOptions ?? []).map((p) => (
              <Pressable
                key={p.id}
                style={[
                  styles.optionRow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => {
                  haptic.tap();
                  setProperty(p);
                  setPropertySearch('');
                }}
              >
                <Ionicons
                  name="home-outline"
                  size={17}
                  color={colors.primary}
                />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text
                    style={{ fontSize: 14.5, color: colors.text }}
                    numberOfLines={1}
                  >
                    {p.title}
                  </Text>
                  <Text
                    style={{ fontSize: 12, color: colors.textFaint }}
                    numberOfLines={1}
                  >
                    {[p.property_code, p.sublocality || p.location]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <Text
          style={[
            styles.label,
            { color: colors.textFaint, fontFamily: f.bold },
          ]}
        >
          Stage
        </Text>
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          {(stages ?? []).map((s) => (
            <FilterChip
              key={s.id}
              label={s.name}
              active={s.id === activeStageId}
              onPress={() => {
                haptic.tap();
                setStageId(s.id);
              }}
            />
          ))}
        </View>

        <Pressable
          onPress={() => {
            haptic.tap();
            if (!closeDate) {
              const inAMonth = new Date();
              inAMonth.setMonth(inAMonth.getMonth() + 1);
              setCloseDate(inAMonth);
            }
            setShowDatePicker((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityLabel={
            closeDate ? 'Change expected close date' : 'Add expected close date'
          }
          style={[
            styles.dateButton,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Ionicons name="calendar-outline" size={16} color={colors.primary} />
          <Text
            style={{
              flex: 1,
              fontSize: 14,
              fontFamily: f.semibold,
              color: colors.text,
            }}
          >
            {closeDate
              ? `Expected close · ${closeDate.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`
              : 'Expected close date (optional)'}
          </Text>
          {closeDate ? (
            <Pressable
              onPress={() => {
                setCloseDate(null);
                setShowDatePicker(false);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear expected close date"
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.textFaint}
              />
            </Pressable>
          ) : null}
        </Pressable>
        {showDatePicker && closeDate ? (
          <InlineDateTimePicker
            value={closeDate}
            mode="date"
            onChange={setCloseDate}
            onClose={() => setShowDatePicker(false)}
          />
        ) : null}

        <TextField
          placeholder="Notes (optional)"
          multiline
          value={notes}
          onChangeText={setNotes}
        />

        <View style={{ marginTop: spacing.sm }}>
          <PrimaryButton
            label="Create deal"
            busy={saving}
            disabled={!title.trim() || !contact || !activeStageId}
            onPress={save}
          />
        </View>

        <Text
          style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}
        >
          Assignment, brokerage and other currencies live on the web's deal
          form.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SelectedRow({
  label,
  detail,
  nameTag,
  icon,
  avatar,
  onClear,
}: {
  label: string | null | undefined;
  detail?: string | null;
  nameTag?: string | null;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  avatar?: boolean;
  onClear: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View
      style={[
        styles.optionRow,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {avatar ? (
        <Avatar name={label ?? '?'} size={30} />
      ) : icon ? (
        <Ionicons name={icon} size={17} color={colors.primary} />
      ) : null}
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          style={{ fontSize: 14.5, fontFamily: f.semibold, color: colors.text }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {detail ? (
          <Text
            style={{ fontSize: 12, color: colors.textFaint }}
            numberOfLines={1}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {nameTag ? <Tag label={nameTag} /> : null}
      <Pressable
        onPress={onClear}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Remove selection"
      >
        <Ionicons name="close-circle" size={18} color={colors.textFaint} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  label: {
    fontSize: 12.5,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
