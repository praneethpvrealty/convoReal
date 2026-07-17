import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { radius, useTheme , fonts } from '@/lib/theme';

const LENGTH = 6;

/**
 * Six-box OTP entry. One invisible TextInput holds the real value
 * (so paste and the numeric keyboard behave natively); the boxes are
 * purely visual, with the active cell highlighted.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
}: {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
}) {
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  function handleChange(raw: string) {
    const code = raw.replace(/\D/g, '').slice(0, LENGTH);
    onChange(code);
    if (code.length === LENGTH) {
      onComplete?.(code);
    }
  }

  const activeIndex = Math.min(value.length, LENGTH - 1);

  return (
    <Pressable onPress={() => inputRef.current?.focus()}>
      <View style={styles.row}>
        {Array.from({ length: LENGTH }, (_, i) => {
          const filled = i < value.length;
          const active = focused && i === activeIndex && value.length < LENGTH;
          return (
            <View
              key={i}
              style={[
                styles.cell,
                {
                  backgroundColor: colors.surface,
                  borderColor: active ? colors.primary : colors.border,
                  borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <Text style={[styles.digit, { color: colors.text }]}>
                {filled ? value[i] : ''}
              </Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={LENGTH}
        style={styles.hidden}
        autoFocus
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  cell: {
    width: 46,
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: { fontSize: 22, fontFamily: fonts.bold },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
});
