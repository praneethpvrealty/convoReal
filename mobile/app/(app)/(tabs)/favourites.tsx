import { Redirect } from 'expo-router';

/**
 * The Favourites tab never actually navigates — its tabPress is
 * intercepted in the tabs layout to toggle the favourites bar. This
 * file exists because expo-router needs a route behind every
 * Tabs.Screen; it only renders if something deep-links straight here,
 * in which case the inbox is a better landing than a blank screen.
 */
export default function FavouritesRoute() {
  return <Redirect href="/(app)/(tabs)" />;
}
