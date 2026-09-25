import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { Banner, FilterChip, PrimaryButton, SectionLabel, TextField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import {
  AREA_UNIT_OPTIONS,
  KIND_OPTIONS,
  USAGE_OPTIONS,
  draftFromSchedule,
  fetchSavedGuidanceValues,
  formatRupees,
  matchSchedule,
  rateHeadline,
  rateLocation,
  readSchedule,
  saveGuidanceValue,
  scheduleFromDraft,
  schedulePrinted,
  type LookupResult,
  type PropertySchedule,
  type ScheduleDraft,
} from '@/lib/guidance-value';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';

interface GuidanceValueScreenProps {
  creditCost?: number | null;
  propertyId?: string | null;
  dealId?: string | null;
  canSave?: boolean;
}

function errorText(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : 'Try again.';
}

export function GuidanceValueScreen({
  creditCost,
  propertyId,
  dealId,
  canSave = false,
}: GuidanceValueScreenProps) {
  const { colors, fonts: f } = useTheme();
  const { show, dialogProps } = useAppDialog();
  const [busy, setBusy] = useState<'read' | 'match' | 'save' | null>(null);
  const [base, setBase] = useState<PropertySchedule | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [buildingRate, setBuildingRate] = useState('');

  const subject = propertyId || dealId ? { propertyId, dealId } : null;
  const savedKey = ['guidance-values-saved', dealId ?? propertyId ?? null];
  const saved = useQuery({
    queryKey: savedKey,
    enabled: Boolean(subject),
    queryFn: () => fetchSavedGuidanceValues({ propertyId, dealId }),
  });

  const options = { building_rate_per_sqft: Number(buildingRate) || null };
  const selected =
    result?.matches.find((m) => m.rate.id === selectedId) ?? result?.matches[0] ?? null;

  const apply = (data: LookupResult) => {
    setResult(data);
    setSelectedId(data.matches[0]?.rate.id ?? null);
  };

  const fail = (title: string, err: unknown) => {
    haptic.warn();
    show({ title, message: friendlyError(errorText(err)) });
  };

  async function pick() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setBusy('read');
    try {
      const data = await readSchedule(
        {
          uri: asset.uri,
          name: asset.name || 'schedule',
          mimeType: asset.mimeType || 'application/octet-stream',
          size: asset.size,
        },
        options
      );
      setBase(data.schedule);
      setDraft(draftFromSchedule(data.schedule));
      apply(data);
      haptic.success();
    } catch (err) {
      fail('Could not read the schedule', err);
    } finally {
      setBusy(null);
    }
  }

  async function rematch() {
    if (!draft) return;
    setBusy('match');
    try {
      apply(await matchSchedule(scheduleFromDraft(draft, base ?? {}), options));
    } catch (err) {
      fail('Could not search rates', err);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!draft || !selected) return;
    setBusy('save');
    try {
      await saveGuidanceValue({
        propertyId,
        dealId,
        rateId: selected.rate.id,
        schedule: scheduleFromDraft(draft, base ?? {}),
        options,
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: savedKey });
    } catch (err) {
      fail('Could not save', err);
    } finally {
      setBusy(null);
    }
  }

  const set = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
  const muted = { color: colors.textMuted, fontFamily: f.regular, fontSize: 13 };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
      <Text style={muted}>
        Upload the schedule of a Karnataka sale deed or an RTC (PDF or photo, under 4 MB). We read the
        location and extent and match it to the published guidance value notification.
        {creditCost ? ` Reading it costs ${creditCost} credits.` : ''}
      </Text>

      <PrimaryButton
        label="Upload schedule"
        icon="document-attach-outline"
        busy={busy === 'read'}
        disabled={busy !== null}
        onPress={pick}
      />
      <Pressable
        onPress={() => {
          setBase({});
          setDraft(draftFromSchedule({ district: 'Bengaluru Urban' }));
          setResult(null);
        }}
        accessibilityRole="button"
      >
        <Text style={{ color: colors.primary, fontFamily: f.bold, textAlign: 'center' }}>
          Enter details manually
        </Text>
      </Pressable>

      {saved.data && saved.data.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel text="Saved" />
          {saved.data.map((row) => (
            <View key={row.id} style={card}>
              <Text style={{ color: colors.text, fontFamily: f.bold, fontSize: 16 }}>
                {formatRupees(Number(row.total_value))}
              </Text>
              <Text style={muted}>
                {row.rate_snapshot.locality ?? row.rate_snapshot.village ?? ''} ·{' '}
                {new Date(row.created_at).toLocaleDateString('en-IN')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {draft ? (
        <View style={{ gap: spacing.md }}>
          <SectionLabel text="Property schedule" />
          {base?.summary ? <Text style={muted}>{base.summary}</Text> : null}
          {base && schedulePrinted(base) ? <Text style={muted}>{schedulePrinted(base)}</Text> : null}
          <TextField label="Area / layout / block" value={draft.locality} onChangeText={(v) => set('locality', v)} />
          <TextField label="Road / street" value={draft.road} onChangeText={(v) => set('road', v)} />
          <TextField label="Village" value={draft.village} onChangeText={(v) => set('village', v)} />
          <TextField label="District" value={draft.district} onChangeText={(v) => set('district', v)} />
          <TextField label="Survey no." value={draft.survey_number} onChangeText={(v) => set('survey_number', v)} />
          <SectionLabel text="Property type" />
          <View style={styles.chips}>
            {KIND_OPTIONS.map((o) => (
              <FilterChip key={o.value} label={o.label} active={draft.kind === o.value} onPress={() => set('kind', draft.kind === o.value ? '' : o.value)} />
            ))}
          </View>
          <SectionLabel text="Usage" />
          <View style={styles.chips}>
            {USAGE_OPTIONS.map((o) => (
              <FilterChip key={o.value} label={o.label} active={draft.usage === o.value} onPress={() => set('usage', draft.usage === o.value ? '' : o.value)} />
            ))}
          </View>
          <TextField label="Land / site area" keyboardType="decimal-pad" value={draft.land_value} onChangeText={(v) => set('land_value', v)} />
          <View style={styles.chips}>
            {AREA_UNIT_OPTIONS.map((o) => (
              <FilterChip key={o.value} label={o.label} active={draft.land_unit === o.value} onPress={() => set('land_unit', o.value)} />
            ))}
          </View>
          <TextField label="Built-up area" keyboardType="decimal-pad" value={draft.built_value} onChangeText={(v) => set('built_value', v)} />
          <View style={styles.chips}>
            {AREA_UNIT_OPTIONS.map((o) => (
              <FilterChip key={o.value} label={o.label} active={draft.built_unit === o.value} onPress={() => set('built_unit', o.value)} />
            ))}
          </View>
          <TextField
            label="Building rate, ₹ per sq.ft (optional)"
            keyboardType="decimal-pad"
            value={buildingRate}
            onChangeText={setBuildingRate}
          />
          <PrimaryButton
            label={result ? 'Recalculate' : 'Search rates'}
            icon="search-outline"
            busy={busy === 'match'}
            disabled={busy !== null}
            onPress={rematch}
          />
        </View>
      ) : null}

      {result && result.coverage !== 'matched' ? (
        <Banner
          kind="info"
          text={
            result.coverage === 'no_rates'
              ? 'Guidance values for this district have not been loaded yet. Check the area on Kaveri Online.'
              : 'No rate matched this area. Check the area and road spelling, or try the village name.'
          }
        />
      ) : null}

      {selected ? (
        <View style={card}>
          <Text style={muted}>Guidance value</Text>
          <Text style={{ color: colors.text, fontFamily: f.bold, fontSize: 26 }}>
            {selected.valuation.total_value !== null
              ? formatRupees(selected.valuation.total_value)
              : '—'}
          </Text>
          <Text style={muted}>{rateHeadline(selected.rate)}</Text>
          {selected.valuation.missing.length > 0 ? (
            <Text style={{ color: colors.danger, fontFamily: f.semibold, fontSize: 13 }}>
              {selected.valuation.missing.includes('land_area')
                ? 'The schedule does not state the land / site area. Enter it and recalculate.'
                : 'Enter the built-up area and recalculate.'}
            </Text>
          ) : null}
          {selected.valuation.building_value !== null ? (
            <Text style={muted}>
              Land {formatRupees(selected.valuation.land_value ?? 0)} + building{' '}
              {formatRupees(selected.valuation.building_value)}
            </Text>
          ) : null}
          <Text style={[muted, { fontSize: 11 }]}>
            An estimate from the published notification. Confirm on Kaveri Online before paying
            stamp duty.
          </Text>
          {canSave && subject ? (
            <PrimaryButton
              label={dealId ? 'Save to transaction' : 'Save to property'}
              icon="save-outline"
              busy={busy === 'save'}
              disabled={busy !== null || selected.valuation.total_value === null}
              onPress={save}
            />
          ) : null}
        </View>
      ) : null}

      {result && result.matches.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel text="Matching rates" />
          {result.matches.map((m) => {
            const active = m.rate.id === selected?.rate.id;
            return (
              <Pressable
                key={m.rate.id}
                onPress={() => setSelectedId(m.rate.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  ...card,
                  active ? { borderColor: colors.primary, borderWidth: 2 } : null,
                ]}
              >
                <View style={styles.row}>
                  <Text style={{ flex: 1, color: colors.text, fontFamily: f.bold }}>
                    {rateLocation(m.rate)}
                  </Text>
                  {active ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} /> : null}
                </View>
                <Text style={{ color: colors.text, fontFamily: f.regular }}>{rateHeadline(m.rate)}</Text>
                <Text style={muted}>
                  {[m.rate.source_title, m.rate.effective_from, m.reasons.join(' · ')]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {saved.error ? <Banner kind="error" text={friendlyError(errorText(saved.error))} /> : null}
      <AppDialog {...dialogProps} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 120 },
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
