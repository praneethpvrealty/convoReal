import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { PrimaryButton } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';
import type {
  EKhataChange,
  EKhataChangeKey,
} from '@/lib/e-khata-fields';

/**
 * Review what an e-Khata proposes before it touches the listing. Values
 * that would replace something already entered start unticked.
 */
export function EKhataReviewSheet({
  visible,
  changes,
  notes,
  onApply,
  onClose,
}: {
  visible: boolean;
  changes: EKhataChange[];
  notes: string[];
  onApply: (keys: EKhataChangeKey[]) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Read from the e-Khata">
      {visible ? (
        <ReviewBody changes={changes} notes={notes} onApply={onApply} />
      ) : null}
    </BottomSheet>
  );
}

function ReviewBody({
  changes,
  notes,
  onApply,
}: {
  changes: EKhataChange[];
  notes: string[];
  onApply: (keys: EKhataChangeKey[]) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [selected, setSelected] = useState<Set<EKhataChangeKey>>(
    () => new Set(changes.filter((c) => !c.replaces).map((c) => c.key))
  );

  function toggle(key: EKhataChangeKey) {
    haptic.tap();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      <ScrollView
        style={[sheetScrollArea, { maxHeight: 460 }]}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}
      >
        {changes.length === 0 ? (
          <Text style={{ fontSize: 14, fontFamily: f.medium, color: colors.textMuted }}>
            The listing already matches this e-Khata.
          </Text>
        ) : (
          changes.map((change) => {
            const active = selected.has(change.key);
            return (
              <Pressable
                key={change.key}
                onPress={() => toggle(change.key)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                style={[
                  styles.row,
                  {
                    borderColor: active ? colors.primary : colors.glassBorder,
                    backgroundColor: active ? colors.primarySoft : colors.glass,
                  },
                ]}
              >
                <Ionicons
                  name={active ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={active ? colors.primary : colors.textFaint}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontFamily: f.bold, color: colors.textFaint }}>
                    {change.label.toUpperCase()}
                  </Text>
                  <Text style={{ fontSize: 14.5, fontFamily: f.medium, color: colors.text }}>
                    {change.value}
                  </Text>
                  {change.replaces ? (
                    <Text style={{ fontSize: 12, fontFamily: f.medium, color: colors.warning }}>
                      Replaces {change.current}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
        {notes.length ? (
          <View
            style={[
              styles.notes,
              { borderColor: colors.glassBorder, backgroundColor: colors.glass },
            ]}
          >
            <Text style={{ fontSize: 11, fontFamily: f.bold, color: colors.textFaint }}>
              ALSO ON THE E-KHATA
            </Text>
            {notes.map((note) => (
              <Text
                key={note}
                style={{ fontSize: 12.5, fontFamily: f.medium, color: colors.textMuted }}
              >
                {note}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <PrimaryButton
          label={selected.size ? `Apply ${selected.size}` : 'Apply'}
          disabled={selected.size === 0}
          onPress={() => onApply([...selected])}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: 6,
  },
  notes: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: 4,
    marginTop: spacing.sm,
  },
});
