import { Redirect, Stack, usePathname } from 'expo-router';

import { isPhoneVerified, useAuthStore } from '@/lib/auth-store';

export default function AppLayout() {
  const session = useAuthStore((s) => s.session);
  const pathname = usePathname();

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  // Same gate as the web dashboard (migration 137): staff must have an
  // OTP-verified WhatsApp number before using the CRM.
  if (!isPhoneVerified(session) && pathname !== '/verify-phone') {
    return <Redirect href="/(app)/verify-phone" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="conversation/[id]"
        options={{ headerShown: true, title: 'Conversation' }}
      />
      <Stack.Screen name="contact/[id]" options={{ headerShown: true, title: 'Contact' }} />
      <Stack.Screen name="verify-phone" />
    </Stack>
  );
}
