import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text } from 'react-native';

import { haptic } from '@/lib/haptics';
import { openHelpCentre } from '@/lib/help-centre';
import { useTheme } from '@/lib/theme';
import { useT } from '@/lib/use-t';

/** "Need help? Help Centre" — the same line the web's sign-in,
 *  sign-up and verification pages carry under their card. */
export function HelpCentreLink() {
  const { colors, fonts: f } = useTheme();
  const t = useT();
  return (
    <Pressable
      testID="help-centre-link"
      onPress={() => {
        haptic.tap();
        void openHelpCentre().catch(() => haptic.warn());
      }}
      hitSlop={10}
      accessibilityRole="link"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
      }}
    >
      <Ionicons name="help-buoy-outline" size={14} color={colors.textFaint} />
      <Text style={{ color: colors.textFaint, fontSize: 13 }}>
        {t('auth.needHelp')}{' '}
        <Text style={{ color: colors.primary, fontFamily: f.semibold }}>
          {t('nav.helpCentre')}
        </Text>
      </Text>
    </Pressable>
  );
}
