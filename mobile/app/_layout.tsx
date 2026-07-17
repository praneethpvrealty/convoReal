import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';

import { useAuthListener, useAuthStore } from '@/lib/auth-store';
import { asyncStoragePersister, queryClient } from '@/lib/query';
import { useTheme } from '@/lib/theme';

export default function RootLayout() {
  useAuthListener();
  const { colors, dark } = useTheme();
  const session = useAuthStore((s) => s.session);

  // Session still being restored from secure storage — hold rendering so
  // the (app) guard doesn't flash the login screen for signed-in users.
  if (session === undefined) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: asyncStoragePersister }}
    >
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
      <StatusBar style={dark ? 'light' : 'dark'} />
    </PersistQueryClientProvider>
  );
}
