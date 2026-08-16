import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { SectionLabel } from '@/components/ui';
import { pickAndUploadFloorPlan } from '@/lib/floor-plan-upload';
import { haptic } from '@/lib/haptics';
import { storagePublicUrl } from '@/lib/storage-url';
import { radius, spacing, useTheme } from '@/lib/theme';

/** String draft of a lib/inventory/floor-plans row (web parity). */
export interface FloorPlanDraft {
  floor: string;
  image: string;
  area_sqft: string;
  notes: string;
}

export const emptyFloorPlan: FloorPlanDraft = {
  floor: '',
  image: '',
  area_sqft: '',
  notes: '',
};

/**
 * Floor plans editor: one plan drawing per floor, stored in the same
 * `property-images` bucket as photos so both surfaces render them the
 * same way. Plans the WhatsApp intake pulled out of a brochure arrive
 * here already pinned to their floor.
 */
export function PropertyFloorPlans({
  plans,
  onChange,
}: {
  plans: FloorPlanDraft[];
  onChange: (next: FloorPlanDraft[]) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const { show, dialogProps } = useAppDialog();

  const update = (idx: number, key: keyof FloorPlanDraft, value: string) =>
    onChange(plans.map((p, i) => (i === idx ? { ...p, [key]: value } : p)));

  async function attach(idx: number) {
    if (busyIdx !== null) return;
    setBusyIdx(idx);
    haptic.tap();
    const outcome = await pickAndUploadFloorPlan();
    setBusyIdx(null);
    if (outcome.status === 'uploaded') {
      update(idx, 'image', outcome.path);
      haptic.success();
    } else if (outcome.status === 'error') {
      haptic.warn();
      show({ title: outcome.title, message: outcome.message });
    }
  }

  const field = {
    backgroundColor: colors.glass,
    borderColor: colors.glassBorder,
    color: colors.text,
    fontFamily: f.regular,
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.head}>
        <SectionLabel text="Floor Plans" />
        <Pressable
          onPress={() => {
            haptic.tap();
            onChange([...plans, { ...emptyFloorPlan }]);
          }}
          accessibilityRole="button"
          accessibilityLabel="Add floor"
          style={styles.addBtn}
        >
          <Ionicons name="add" size={15} color={colors.primary} />
          <Text
            style={{ fontSize: 12, fontFamily: f.bold, color: colors.primary }}
          >
            Add Floor
          </Text>
        </Pressable>
      </View>

      {plans.map((plan, i) => (
        <View
          key={i}
          style={[
            styles.card,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
          ]}
        >
          <View style={styles.row}>
            <Pressable
              onPress={() => attach(i)}
              accessibilityRole="button"
              accessibilityLabel={`Attach plan for floor ${i + 1}`}
              style={[styles.thumb, { borderColor: colors.glassBorder }]}
            >
              {busyIdx === i ? (
                <ActivityIndicator color={colors.primary} />
              ) : plan.image ? (
                <Image
                  source={{ uri: storagePublicUrl(plan.image) }}
                  style={styles.thumbImg}
                  resizeMode="contain"
                />
              ) : (
                <Ionicons
                  name="grid-outline"
                  size={22}
                  color={colors.textMuted}
                />
              )}
            </Pressable>

            <View style={{ flex: 1, gap: spacing.xs }}>
              <TextInput
                value={plan.floor}
                onChangeText={(v) => update(i, 'floor', v)}
                placeholder="Ground Floor"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, field]}
              />
              <TextInput
                value={plan.area_sqft}
                onChangeText={(v) =>
                  update(i, 'area_sqft', v.replace(/[^0-9]/g, ''))
                }
                placeholder="Area (Sq.Ft.)"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                style={[styles.input, field]}
              />
            </View>

            <Pressable
              onPress={() => {
                haptic.tap();
                onChange(plans.filter((_, idx) => idx !== i));
              }}
              accessibilityRole="button"
              accessibilityLabel={`Remove floor ${i + 1}`}
              style={{ padding: spacing.xs }}
            >
              <Ionicons
                name="trash-outline"
                size={16}
                color={colors.textMuted}
              />
            </Pressable>
          </View>

          <TextInput
            value={plan.notes}
            onChangeText={(v) => update(i, 'notes', v)}
            placeholder="e.g. 3 BHK + pooja room"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, field]}
          />
        </View>
      ))}

      {plans.length === 0 ? (
        <Text
          style={{
            fontSize: 12,
            fontFamily: f.regular,
            color: colors.textMuted,
          }}
        >
          No floor plans yet.
        </Text>
      ) : null}

      <AppDialog {...dialogProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thumb: {
    width: 60,
    height: 60,
    borderWidth: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontSize: 13,
  },
});
