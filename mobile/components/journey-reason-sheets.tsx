import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { ChoiceChip, PrimaryButton, TextField } from '@/components/ui';
import {
  CLOSED_JOURNEY_STATUS_LABELS,
  JOURNEY_CLOSURE_REASONS,
  JOURNEY_REASON_MAX_LENGTH,
  QUICK_DROP_REASONS,
  type ClosedJourneyStatus,
} from '@/lib/journey-overview';
import { spacing, useTheme } from '@/lib/theme';

const CLOSED_STATUSES: ClosedJourneyStatus[] = [
  'completed',
  'paused',
  'not_proceeding',
];

/** Web parity: `CloseJourneyDialog` in src/components/journey/close-journey-dialog.tsx. */
export function CloseJourneySheet({
  journeyName,
  onSubmit,
  onClose,
}: {
  journeyName: string | null;
  onSubmit: (status: ClosedJourneyStatus, reason: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={journeyName !== null}
      onClose={onClose}
      title={journeyName ? `Close ${journeyName}'s journey` : undefined}
    >
      {journeyName !== null ? (
        <CloseJourneyForm key={journeyName} onSubmit={onSubmit} />
      ) : null}
    </BottomSheet>
  );
}

function CloseJourneyForm({
  onSubmit,
}: {
  onSubmit: (status: ClosedJourneyStatus, reason: string) => Promise<void>;
}) {
  const { colors, fonts: f } = useTheme();
  const [status, setStatus] = useState<ClosedJourneyStatus>('completed');
  const [reason, setReason] = useState(JOURNEY_CLOSURE_REASONS.completed[0]);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!reason.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit(status, reason.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text style={{ fontSize: 13, color: colors.textMuted }}>
        Record the outcome without losing the properties, progress, notes, or
        timeline. You can reopen it later.
      </Text>
      <View style={styles.chips}>
        {CLOSED_STATUSES.map((option) => (
          <ChoiceChip
            key={option}
            label={CLOSED_JOURNEY_STATUS_LABELS[option]}
            selected={status === option}
            onPress={() => {
              setStatus(option);
              setReason(JOURNEY_CLOSURE_REASONS[option][0]);
            }}
          />
        ))}
      </View>
      <Text
        style={{ fontSize: 12, fontFamily: f.bold, color: colors.textMuted }}
      >
        Reason
      </Text>
      <View style={styles.chips}>
        {JOURNEY_CLOSURE_REASONS[status].map((option) => (
          <ChoiceChip
            key={option}
            label={option}
            selected={reason === option}
            onPress={() => setReason(option)}
          />
        ))}
      </View>
      <TextField
        value={reason}
        onChangeText={setReason}
        maxLength={JOURNEY_REASON_MAX_LENGTH}
        multiline
        placeholder="Add the specific context for future reference"
      />
      <PrimaryButton
        label="Close journey"
        busy={saving}
        disabled={!reason.trim()}
        onPress={() => void submit()}
      />
    </View>
  );
}

/** Web parity: the drop form in src/components/journey/journey-item-sheet.tsx. */
export function DropBranchSheet({
  stageName,
  onSubmit,
  onClose,
}: {
  stageName: string | null;
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={stageName !== null}
      onClose={onClose}
      title={stageName ? `Drop at ${stageName}…` : undefined}
    >
      {stageName !== null ? (
        <DropBranchForm key={stageName} onSubmit={onSubmit} />
      ) : null}
    </BottomSheet>
  );
}

function DropBranchForm({
  onSubmit,
}: {
  onSubmit: (reason: string) => Promise<void>;
}) {
  const { colors, fonts: f } = useTheme();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!reason.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit(reason.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text
        style={{ fontSize: 12, fontFamily: f.bold, color: colors.textMuted }}
      >
        Why is this being dropped?
      </Text>
      <View style={styles.chips}>
        {QUICK_DROP_REASONS.map((option) => (
          <ChoiceChip
            key={option}
            label={option}
            selected={reason === option}
            onPress={() => setReason(option)}
          />
        ))}
      </View>
      <TextField
        value={reason}
        onChangeText={setReason}
        maxLength={JOURNEY_REASON_MAX_LENGTH}
        multiline
        placeholder="Reason (shown on the map)"
      />
      <PrimaryButton
        label="Drop"
        icon="ban-outline"
        busy={saving}
        disabled={!reason.trim()}
        onPress={() => void submit()}
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
