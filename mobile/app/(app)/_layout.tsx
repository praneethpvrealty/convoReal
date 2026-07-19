import { Redirect, Stack, usePathname } from 'expo-router';

import { isPhoneVerified, useAuthStore } from '@/lib/auth-store';
import { useSurface } from '@/lib/surface';
import { useTheme } from '@/lib/theme';

export default function AppLayout() {
  const session = useAuthStore((s) => s.session);
  const surface = useSurface((s) => s.surface);
  const pathname = usePathname();
  const { colors, fonts: f } = useTheme();

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  // This device signed in as a property owner — the staff CRM is not
  // its surface; the Den shell owns the session.
  if (surface === 'den') {
    return <Redirect href="/(den)/den" />;
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
        headerTitleStyle: { fontFamily: f.bold, color: colors.text },
        // Solid underlay matching the aurora base — native headers
        // can't take a translucent fill without layout surprises.
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: 'transparent' },
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
