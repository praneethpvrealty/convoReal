import { Text, type StyleProp, type TextStyle } from 'react-native';
import { parseWhatsAppFormatting } from '@shared/lib/conversations/text-format';
import { useTheme } from '@/lib/theme';

export function FormattedText({
  text,
  style,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
}) {
  const { fonts } = useTheme();
  return (
    <Text style={style}>
      {parseWhatsAppFormatting(text).map((segment, i) => (
        <Text
          key={i}
          style={[
            segment.bold ? { fontFamily: fonts.bold } : null,
            segment.italic ? { fontStyle: 'italic' } : null,
            segment.strike ? { textDecorationLine: 'line-through' } : null,
            segment.mono ? { fontFamily: 'monospace' } : null,
          ]}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}
