import AsyncStorage from '@react-native-async-storage/async-storage';
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
