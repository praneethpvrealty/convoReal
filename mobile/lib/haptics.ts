import * as Haptics from 'expo-haptics';

/**
 * Centralized haptics so the app has ONE tactile vocabulary:
 * tap    — selections, tab switches, chips
 * send   — a message/template left the device
 * success— something completed (deal moved, appointment created)
 * warn   — destructive or failed
 * Fire-and-forget; failures (simulator, disabled) are swallowed.
 */
export const haptic = {
  tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  send: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  success: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  warn: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
};
