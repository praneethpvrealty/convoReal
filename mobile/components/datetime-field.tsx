import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, useTheme, fonts } from '@/lib/theme';

/**
 * Platform-correct inline date/time picker. Android shows a dialog
 * that fires onChange exactly once (confirm or dismiss), so we close
 * on the first event. iOS renders an inline spinner that fires
 * onChange on EVERY scroll tick — auto-closing there collapsed the
 * picker under the user's first flick, so on iOS the spinner stays
 * mounted and only its Done button closes it.
 */
export function InlineDateTimePicker({
  value,
  mode,
  onChange,
  onClose,
}: {
  value: Date;
  mode: 'date' | 'time';
  onChange: (date: Date) => void;
  onClose: () => void;
}) {
  const { colors, dark } = useTheme();

  if (Platform.OS === 'android') {
    return (
      <DateTimePicker
        value={value}
        mode={mode}
        onChange={(_, date) => {
          onClose();
          if (date) onChange(date);
        }}
      />
    );
  }

  return (
    <View
      style={[
        styles.iosWrap,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <DateTimePicker
        value={value}
        mode={mode}
        display="spinner"
        themeVariant={dark ? 'dark' : 'light'}
        onChange={(_, date) => {
          if (date) onChange(date);
        }}
      />
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Done"
        style={styles.doneButton}
      >
        <Text style={{ color: colors.primary, fontSize: 15.5, fontFamily: fonts.bold }}>
          Done
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  iosWrap: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  doneButton: { alignItems: 'center', paddingVertical: 12, minHeight: 44 },
});
