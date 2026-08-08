import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';

export type AttachmentChoice = 'photo' | 'camera' | 'document';

const CHOICES: {
  key: AttachmentChoice;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
}[] = [
  {
    key: 'photo',
    icon: 'images-outline',
    label: 'Photo or video',
    hint: 'From the gallery — up to 5 MB a photo, 16 MB a video',
  },
  {
    key: 'camera',
    icon: 'camera-outline',
    label: 'Camera',
    hint: 'Take a photo now',
  },
  {
    key: 'document',
    icon: 'document-text-outline',
    label: 'Document',
    hint: 'Brochure, floor plan, agreement — up to 100 MB',
  },
];

/**
 * The attach menu behind the composer's paperclip. Each row states the
 * cap WhatsApp enforces for that kind, because the refusal otherwise
 * arrives after the file has been picked and uploaded.
 */
export function AttachmentSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (choice: AttachmentChoice) => void;
}) {
  const { colors, fonts: f } = useTheme();

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Attach">
      <View style={{ gap: spacing.xs, paddingBottom: spacing.md }}>
        {CHOICES.map((choice) => (
          <Pressable
            key={choice.key}
            onPress={() => {
              haptic.tap();
              onClose();
              onPick(choice.key);
            }}
            accessibilityRole="button"
            accessibilityLabel={choice.label}
            accessibilityHint={choice.hint}
            android_ripple={{ color: colors.border }}
            style={styles.row}
          >
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name={choice.icon} size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontSize: 15, fontFamily: f.semibold, color: colors.text }}>
                {choice.label}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{choice.hint}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
