import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { FilterChip, PrimaryButton, TextField } from '@/components/ui';
import {
  LOST_REASONS,
  lostReasonNeedsNote,
  type LostReason,
  type LostReasonInput,
} from '@/lib/lost-reasons';
import { spacing, useTheme } from '@/lib/theme';

/** Web parity: `LostReasonDialog` in src/components/pipelines/lost-reason-dialog.tsx. */
export function LostReasonSheet({
  dealTitle,
  onConfirm,
  onClose,
}: {
  dealTitle: string | null;
  onConfirm: (input: LostReasonInput) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={dealTitle !== null}
      onClose={onClose}
      title="Why was this deal lost?"
    >
      {dealTitle !== null ? (
        <LostReasonForm
          key={dealTitle}
          dealTitle={dealTitle}
          onConfirm={onConfirm}
        />
      ) : null}
    </BottomSheet>
  );
}

export function LostReasonPicker({
  reason,
  note,
  onReason,
  onNote,
}: {
  reason: LostReason | null;
  note: string;
  onReason: (reason: LostReason) => void;
  onNote: (note: string) => void;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.chips}>
        {LOST_REASONS.map((option) => (
          <FilterChip
            key={option}
            label={option}
            active={reason === option}
            onPress={() => onReason(option)}
          />
        ))}
      </View>
      <TextField
        label={
          lostReasonNeedsNote(reason) ? 'What happened?' : 'Note (optional)'
        }
        value={note}
        onChangeText={onNote}
        maxLength={500}
        multiline
        placeholder="e.g. Owner wants ₹20 L more than the buyer's ceiling"
      />
    </View>
  );
}

function LostReasonForm({
  dealTitle,
  onConfirm,
}: {
  dealTitle: string;
  onConfirm: (input: LostReasonInput) => void;
}) {
  const { colors } = useTheme();
  const [reason, setReason] = useState<LostReason | null>(null);
  const [note, setNote] = useState('');
  const noteMissing = lostReasonNeedsNote(reason) && !note.trim();

  return (
    <View style={styles.form}>
      <Text style={{ fontSize: 13, color: colors.textMuted }}>
        “{dealTitle}” moves to Closed Lost. The reason stays on the deal and its
        journey.
      </Text>
      <LostReasonPicker
        reason={reason}
        note={note}
        onReason={setReason}
        onNote={setNote}
      />
      <PrimaryButton
        label="Mark lost"
        disabled={!reason || noteMissing}
        onPress={() =>
          reason &&
          onConfirm({ lost_reason: reason, lost_note: note.trim() || null })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
