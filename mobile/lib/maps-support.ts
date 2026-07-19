import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Google Maps was removed from Expo Go on Android (SDK 53+), and even
 * a configured API key can't reach Expo Go's manifest — native map
 * tiles only render there in a real (EAS) build. iOS Expo Go still
 * draws Apple Maps. Screens use this to swap MapView for a graceful
 * fallback instead of a black canvas.
 */
export const nativeMapsAvailable = !(
  Platform.OS === 'android' && Constants.executionEnvironment === 'storeClient'
);
