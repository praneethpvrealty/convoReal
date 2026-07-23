import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { registerDevice } from './api';

// Foreground notifications still surface a banner + sound rather than
// being swallowed while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

async function registerForPushNotifications(): Promise<void> {
  if (!Device.isDevice) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#0A1F16',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') return;

  const id = projectId();
  if (!id) return;

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
  if (!token) return;

  await registerDevice(token, Platform.OS);
}

/**
 * Register this device's Expo push token with the backend once the user
 * is signed in. Runs once per app session; failures are swallowed so a
 * denied permission or offline start never blocks the app.
 */
export function usePushRegistration(enabled: boolean): void {
  const done = useRef(false);
  useEffect(() => {
    if (!enabled || done.current) return;
    done.current = true;
    registerForPushNotifications().catch((err) => {
      console.warn('[push] registration failed:', err);
      done.current = false;
    });
  }, [enabled]);
}
