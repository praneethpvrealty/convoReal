import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useCopilotTour } from '@/components/copilot-tour';
import { openCopilotDesktopWeb } from '@/lib/copilot-links';
import { ENV } from '@/lib/env';
import { haptic } from '@/lib/haptics';
import type { UiMessageKey } from '@/lib/i18n';
import { useSetupChecklist } from '@/lib/onboarding';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useT } from '@/lib/use-t';
import type { SetupStepId } from '@shared/lib/onboarding/checklist';

// ------------------------------------------------------------------
// Mobile counterpart of the web's SetupChecklist card: the owner's
// remaining setup steps on the inbox, each chip taking them to where
// the step is done — natively when the app has the screen (a tour for
// the first contact, the Properties tab), on the desktop web for the
// WhatsApp connection and portal lead forwarding, which are web-only.
// ------------------------------------------------------------------

const LABEL: Record<SetupStepId, UiMessageKey> = {
  whatsapp: 'setup.whatsapp',
  property: 'setup.property',
  contact: 'setup.contacts',
  'email-leads': 'setup.emailLeads',
};

export function SetupChecklist() {
  const { colors, fonts: f } = useTheme();
  const t = useT();
  const { steps, show, dismiss } = useSetupChecklist();
  const { startTour } = useCopilotTour();

  if (!show || !steps) return null;
  const doneCount = steps.filter((s) => s.done).length;

  const open = (id: SetupStepId) => {
    haptic.tap();
    if (id === 'contact') startTour('add-contact');
    else if (id === 'property') router.push('/(app)/(tabs)/properties');
    else if (id === 'whatsapp')
      void openCopilotDesktopWeb(`${ENV.apiBaseUrl}/settings?tab=whatsapp`);
    else void openCopilotDesktopWeb(`${ENV.apiBaseUrl}/settings?tab=other`);
  };

  return (
    <View
      testID="setup-checklist"
      style={[
        styles.card,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <View style={styles.titleRow}>
        <Text
          style={[styles.title, { color: colors.text, fontFamily: f.bold }]}
        >
          {t('setup.title')}{' '}
          <Text style={{ color: colors.textMuted, fontFamily: f.regular }}>
            · {doneCount}/{steps.length}
          </Text>
        </Text>
        <Pressable
          onPress={() => {
            haptic.tap();
            dismiss();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('setup.dismiss')}
        >
          <Ionicons name="close" size={18} color={colors.textFaint} />
        </Pressable>
      </View>
      <View style={styles.chips}>
        {steps.map((step) => (
          <Pressable
            key={step.id}
            disabled={step.done}
            onPress={() => open(step.id)}
            accessibilityRole="button"
            accessibilityState={{ checked: step.done }}
            style={[
              styles.chip,
              {
                backgroundColor: step.done
                  ? colors.successSoft
                  : colors.surfaceWell,
                borderColor: step.done ? colors.success : colors.glassBorder,
              },
            ]}
          >
            <Ionicons
              name={step.done ? 'checkmark-circle' : 'ellipse-outline'}
              size={14}
              color={step.done ? colors.success : colors.textFaint}
            />
            <Text
              style={[
                styles.chipText,
                {
                  color: step.done ? colors.success : colors.text,
                  fontFamily: f.semibold,
                },
              ]}
            >
              {t(LABEL[step.id])}
            </Text>
            {!step.done &&
            (step.id === 'whatsapp' || step.id === 'email-leads') ? (
              <Ionicons
                name="globe-outline"
                size={12}
                color={colors.textFaint}
              />
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  chipText: { fontSize: 12 },
});
