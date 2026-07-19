import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';

import { useAuthStore } from '@/lib/auth-store';
import { completeDenAuth } from '@/lib/den-api';
import { queryClient } from '@/lib/query';
import { useTheme } from '@/lib/theme';

/**
 * Owners Den shell. One Supabase session serves both surfaces; the
 * persisted surface flag routed us here. On every entry we call the
 * idempotent /api/den/auth/complete (same as the web client) so
 * den_users exists and new agency relationships link up lazily.
 */
export default function DenLayout() {
  const session = useAuthStore((s) => s.session);
  const { colors, fonts: f } = useTheme();

  useEffect(() => {
    if (!session) return;
    completeDenAuth()
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['den-me'] });
        queryClient.invalidateQueries({ queryKey: ['den-dashboard'] });
      })
      .catch(() => {
        // Non-fatal: screens surface their own errors.
      });
  }, [session]);

  if (!session) {
    return <Redirect href="/(auth)/den-login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitleStyle: { fontFamily: f.bold, color: colors.text },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: 'transparent' },
        animation: 'slide_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="den/index" options={{ headerShown: false }} />
      <Stack.Screen name="den/bids" options={{ title: 'Offers' }} />
      <Stack.Screen name="den/settings" options={{ title: 'Den Settings' }} />
    </Stack>
  );
}
