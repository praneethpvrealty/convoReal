import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { InlineDateTimePicker } from '@/components/datetime-field';
import { ConvoRealLoader } from '@/components/loader';
import {
  Avatar,
  Banner,
  FilterChip,
  PriceHint,
  PrimaryButton,
  Tag,
  TextField,
  nameTagCap,
} from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact, Deal, PipelineStage } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';
import { contactHandle, hasPhone } from '@/lib/reachability';

/**
 * Web parity: the deal form (deal-form.tsx). Creating posts to
 * /api/deals, editing PUTs /api/deals/[id], deleting DELETEs it —
 * all three sync the linked property's status server-side off the
 * stage name. Assignment, brokerage and non-INR currencies stay on
 * the web's fuller form.
 *
 * With `?id=`, the deal loads before the form mounts so every field
 * starts at its stored value — no prop-to-state effect to keep in sync.
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

interface DealRow extends Deal {
  notes?: string | null;
}

export default function DealFormScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    pipelineId?: string;
    stageId?: string;
  }>();
  const dealId = params.id ?? null;

  const existing = useQuery({
    queryKey: ['deal', dealId],
    enabled: Boolean(dealId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deals')
        .select(
          '*, contact:contacts(id, name, phone, name_tag), property:properties(id, title, property_code, location, sublocality)'
        )
        .eq('id', dealId!)
        .single();
      if (error) throw error;
      return data as DealRow;
    },
  });

  if (dealId && !existing.data) {
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ headerShown: true, title: 'Edit deal' }} />
        {existing.isError ? (
          <View style={styles.container}>
            <Banner kind="error" text="Could not load this deal." />
          </View>
        ) : (
          <ConvoRealLoader style={{ alignSelf: 'center', marginTop: 60 }} />
        )}
      </View>
    );
  }

  return (
    <DealForm
      deal={existing.data ?? null}
      pipelineId={existing.data?.pipeline_id ?? params.pipelineId ?? null}
      defaultStageId={existing.data?.stage_id ?? params.stageId ?? null}
    />
  );
}

function DealForm({
  deal,
  pipelineId,
  defaultStageId,
}: {
  deal: DealRow | null;
  pipelineId: string | null;
  defaultStageId: string | null;
}) {
  const { colors, fonts: f } = useTheme();
  const dialog = useAppDialog();

  const [title, setTitle] = useState(deal?.title ?? '');
  const [value, setValue] = useState(deal?.value ? String(deal.value) : '');
  const [stageId, setStageId] = useState<string | null>(defaultStageId);
  const [contact, setContact] = useState<Contact | null>(deal?.contact ?? null);
  const [contactSearch, setContactSearch] = useState('');
  const [property, setProperty] = useState<PropertyOption | null>(
    (deal?.property as PropertyOption | undefined) ?? null
  );
  const [propertySearch, setPropertySearch] = useState('');
  const [closeDate, setCloseDate] = useState<Date | null>(
    deal?.expected_close_date ? new Date(deal.expected_close_date) : null
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [notes, setNotes] = useState(deal?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      await apiFetch(deal ? `/api/deals/${deal.id}` : '/api/deals', {
        method: deal ? 'PUT' : 'POST',
        body: JSON.stringify({
          title: title.trim(),
          value: parseFloat(value) || 0,
          currency: deal?.currency || 'INR',
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
      if (deal) queryClient.invalidateQueries({ queryKey: ['deal', deal.id] });
      router.back();
    } catch (err) {
      haptic.warn();
      setError(
        err instanceof ApiError
          ? err.message
          : deal
            ? 'Could not save this deal.'
            : 'Could not create the deal.'
      );
      setSaving(false);
    }
  }

  async function remove() {
    if (!deal) return;
    haptic.warn();
    setDeleting(true);
    setError(null);
    try {
      // The route also resets a linked property back to Available.
      await apiFetch(`/api/deals/${deal.id}`, { method: 'DELETE' });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      router.back();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not delete this deal.'
      );
      setDeleting(false);
    }
  }

  function confirmDelete() {
    dialog.show({
      title: 'Delete this deal?',
      message: `“${deal?.title}” will be removed for everyone. A linked property goes back to Available.`,
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: dialog.close },
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: () => {
            dialog.close();
            void remove();
          },
        },
      ],
    });
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{ headerShown: true, title: deal ? 'Edit deal' : 'New deal' }}
      />
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
                <Avatar name={c.name || contactHandle(c)} size={30} />
                <Text
                  style={{ flexShrink: 1, fontSize: 14.5, color: colors.text }}
                  numberOfLines={1}
                >
                  {c.name || c.phone}
                </Text>
                {c.name_tag ? (
                  <View style={nameTagCap}>
                    <Tag label={c.name_tag} />
                  </View>
                ) : null}
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
            label={deal ? 'Save changes' : 'Create deal'}
            busy={saving}
            disabled={!title.trim() || !contact || !activeStageId || deleting}
            onPress={save}
          />
        </View>

        {deal ? (
          <Pressable
            onPress={confirmDelete}
            disabled={saving || deleting}
            accessibilityRole="button"
            accessibilityLabel="Delete this deal"
            style={styles.deleteRow}
          >
            {deleting ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Ionicons name="trash-outline" size={15} color={colors.danger} />
            )}
            <Text
              style={{ fontSize: 13, fontFamily: f.bold, color: colors.danger }}
            >
              {deleting ? 'Deleting…' : 'Delete deal'}
            </Text>
          </Pressable>
        ) : null}

        <Text
          style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}
        >
          Assignment, brokerage and other currencies live on the web's deal
          form.
        </Text>
      </ScrollView>
      <AppDialog {...dialog.dialogProps} />
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
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.md,
  },
});
