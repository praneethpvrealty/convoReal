import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { canDrawNativeMaps } from '@/lib/maps-availability';

/** Screens use this to swap MapView for a graceful fallback instead of
 *  a black canvas; see lib/maps-availability.ts for when that is. */
export const nativeMapsAvailable = canDrawNativeMaps({
  os: Platform.OS,
  executionEnvironment: Constants.executionEnvironment,
  googleMapsConfigured: Constants.expoConfig?.extra?.googleMapsConfigured,
});
