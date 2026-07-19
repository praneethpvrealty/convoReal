import { Redirect, Stack } from 'expo-router';

import { useAuthStore } from '@/lib/auth-store';
import { useSurface } from '@/lib/surface';

export default function AuthLayout() {
  const session = useAuthStore((s) => s.session);
  const surface = useSurface((s) => s.surface);

  if (session) {
    return <Redirect href={surface === 'den' ? '/(den)/den' : '/(app)/(tabs)'} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: 'transparent' },
      }}
    />
  );
}
