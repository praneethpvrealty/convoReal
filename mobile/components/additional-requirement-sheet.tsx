import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { SuccessSheet } from '@/components/success-sheet';
import { Banner, PrimaryButton, TextField } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { spacing, useTheme } from '@/lib/theme';
import type { Contact, ContactRequirementProfile } from '@/lib/types';

interface SaveResult {
  data: {
    profile: ContactRequirementProfile;
    duplicate: boolean;
    match_count: number;
    alerts_active: boolean;
  };
}

export function AdditionalRequirementSheet({
  visible,
  onClose,
  contact,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  contact: Contact;
  onSaved?: (profile: ContactRequirementProfile) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult['data'] | null>(null);
  const name = contact.name?.trim() || 'this buyer';

  function closeSheet() {
    if (saving) return;
    setText('');
    setError(null);
    setResult(null);
    onClose();
  }

  async function save() {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch<SaveResult>(
        `/api/contacts/${contact.id}/requirements`,
        {
          method: 'POST',
          body: JSON.stringify({ text, source: 'personal_whatsapp' }),
        }
      );
      setResult(response.data);
      onSaved?.(response.data.profile);
      haptic.success();
    } catch (reason) {
      haptic.warn();
      setError(
        friendlyError(
          reason instanceof Error
            ? reason.message
            : 'Could not save the requirement'
        )
      );
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    const matchText = result.match_count
      ? `${result.match_count} current match${result.match_count === 1 ? '' : 'es'} found.`
      : 'No current match yet; Match Radar will keep watching.';
    const deliveryText = result.alerts_active
      ? ' Future matches will be sent from the connected business WhatsApp.'
      : ' WhatsApp alerts are not enabled, so future matches will stay in Match Radar.';
    return (
      <SuccessSheet
        visible={visible}
        onClose={closeSheet}
        title={
          result.duplicate ? 'Requirement already saved' : 'Requirement added'
        }
        message={`${result.profile.title}. ${matchText}${deliveryText}`}
        confetti={false}
        actions={[
          { icon: 'checkmark-outline', label: 'Done', onPress: closeSheet },
        ]}
      />
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={closeSheet}
      title="Add a brief"
    >
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
          Paste what {name} sent on your personal WhatsApp. It is saved as a
          separate brief and will not overwrite their existing search.
        </Text>

        <View
          style={{
            flexDirection: 'row',
            gap: spacing.md,
            padding: spacing.lg,
            borderRadius: 14,
            backgroundColor: colors.primarySoft,
          }}
        >
          <Ionicons name="radio-outline" size={21} color={colors.primary} />
          <Text
            style={{
              flex: 1,
              color: colors.textMuted,
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            AI extracts the area, type, size and budget, checks current
            inventory, and keeps this brief active for Match Radar and WhatsApp
            alerts.
          </Text>
        </View>

        <TextField
          label="REQUIREMENT MESSAGE"
          value={text}
          onChangeText={setText}
          placeholder="For Dabaspete, 2–3 acres, for cold storage / warehouse on or close to STRR"
          multiline
          maxLength={4000}
          autoFocus
          style={{ minHeight: 120, fontFamily: f.regular }}
        />
        {error ? <Banner kind="error" text={error} /> : null}
        <PrimaryButton
          label="Save to Engine"
          icon="add-circle-outline"
          busy={saving}
          disabled={!text.trim()}
          onPress={save}
          testID="additional-requirement-save"
        />
      </View>
    </BottomSheet>
  );
}
