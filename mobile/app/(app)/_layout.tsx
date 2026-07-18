import { Redirect, Stack, usePathname } from 'expo-router';

import { isPhoneVerified, useAuthStore } from '@/lib/auth-store';
import { fonts, useTheme } from '@/lib/theme';

export default function AppLayout() {
  const session = useAuthStore((s) => s.session);
  const pathname = usePathname();
  const { colors } = useTheme();

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  // Same gate as the web dashboard (migration 137): staff must have an
  // OTP-verified WhatsApp number before using the CRM.
  if (!isPhoneVerified(session) && pathname !== '/verify-phone') {
    return <Redirect href="/(app)/verify-phone" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerTitleStyle: { fontFamily: fonts.bold, color: colors.text },
        headerStyle: { backgroundColor: colors.tabBar },
        headerTintColor: colors.text,
        headerShadowVisible: false,
      }}
    >
      {/* Screens register themselves; each file owns its title and
          headerRight via its own <Stack.Screen options>. The shared
          header look lives in screenOptions above. */}
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="verify-phone" />
    </Stack>
  );
}
