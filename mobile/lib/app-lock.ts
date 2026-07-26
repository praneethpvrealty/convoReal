import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface AppLockState {
  /** User opted into biometric unlock (persisted). */
  enabled: boolean;
  /** Whether the current session is behind the lock screen right now.
   *  Runtime-only — a cold start of an enabled app always starts locked. */
  locked: boolean;
  setEnabled: (enabled: boolean) => void;
  setLocked: (locked: boolean) => void;
}

export const useAppLock = create<AppLockState>()(
  persist(
    (set) => ({
      enabled: false,
      locked: false,
      setEnabled: (enabled) => set({ enabled, locked: false }),
      setLocked: (locked) => set({ locked }),
    }),
    {
      name: 'app-lock',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ enabled: s.enabled }),
      // A cold start with the lock enabled begins locked; the gate
      // prompts for the fingerprint as soon as it mounts.
      onRehydrateStorage: () => (state) => {
        if (state?.enabled) state.setLocked(true);
      },
    }
  )
);

/**
 * Device supports biometric unlock: hardware present AND at least one
 * fingerprint/face enrolled. Lazily imports the native module so builds
 * that predate it degrade to "not available" instead of crashing.
 */
export async function biometricsAvailable(): Promise<boolean> {
  try {
    const LocalAuthentication = await import('expo-local-authentication');
    const [hasHardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && enrolled;
  } catch {
    return false;
  }
}

/**
 * Android FLAG_SECURE, via expo-screen-capture. Android grabs the
 * recents thumbnail as the activity pauses — earlier than a React cover
 * can paint — so the flag has to be up for as long as the lock is
 * enabled, not just while backgrounding. It also blocks screenshots and
 * screen recording of the app, which is the point.
 *
 * Android only: iOS already gets its switcher covered by AppLockGate,
 * and preventScreenCapture there would block agents' screenshots for no
 * added protection.
 */
export async function setScreenCaptureBlocked(blocked: boolean): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const ScreenCapture = await import('expo-screen-capture');
    if (blocked) {
      await ScreenCapture.preventScreenCaptureAsync('app-lock');
    } else {
      await ScreenCapture.allowScreenCaptureAsync('app-lock');
    }
  } catch {
    // Native module missing (old build) — nothing to toggle.
  }
}

/** Prompt the OS biometric sheet. Resolves true on success. */
export async function authenticate(): Promise<boolean> {
  try {
    const LocalAuthentication = await import('expo-local-authentication');
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock ConvoReal',
      cancelLabel: 'Cancel',
    });
    return result.success;
  } catch {
    // Native module missing (old build) — never lock the user out.
    return true;
  }
}
