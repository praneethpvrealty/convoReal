// ------------------------------------------------------------------
// The More menu registry and its favourites list — pure data plus list
// operations, no runtime RN imports, so this stays testable under the
// plain Node vitest runner (same split as home-widgets.ts).
//
// Favourites are keyed by id rather than by href: a renamed route then
// can't leave a dead entry in a user's pinned list, and labels/icons
// live here alone instead of being copied into storage the way the
// web's localStorage favourites are.
// ------------------------------------------------------------------

import type { Ionicons } from '@expo/vector-icons';

export const MENU_LINKS = {
  focus: { href: '/(app)/focus', icon: 'sunny-outline', label: 'Focus' },
  deals: {
    href: '/(app)/deals',
    icon: 'trending-up-outline',
    label: 'Deals & pipelines',
  },
  radar: { href: '/(app)/radar', icon: 'radio-outline', label: 'Match Radar' },
  journey: { href: '/(app)/journey', icon: 'map-outline', label: 'Journeys' },
  dashboard: {
    href: '/(app)/dashboard',
    icon: 'stats-chart-outline',
    label: 'Overview & stats',
  },
  broadcasts: {
    href: '/(app)/broadcasts',
    icon: 'megaphone-outline',
    label: 'Broadcast campaigns',
  },
  voiceCampaigns: {
    href: '/(app)/voice-campaigns',
    icon: 'call-outline',
    label: 'Voice campaigns',
  },
  announcements: {
    href: '/(app)/announcements',
    icon: 'mic-outline',
    label: 'Audio announcements',
  },
  greetings: {
    href: '/(app)/greetings',
    icon: 'sparkles-outline',
    label: 'Occasion greetings',
  },
  pulse: {
    href: '/(app)/pulse',
    icon: 'analytics-outline',
    label: 'Showcase Pulse',
  },
  gaps: {
    href: '/(app)/gaps',
    icon: 'alert-circle-outline',
    label: 'Conversation gaps',
  },
  automations: {
    href: '/(app)/automations',
    icon: 'git-branch-outline',
    label: 'Automations & flows',
  },
  credits: {
    href: '/(app)/credits',
    icon: 'flash-outline',
    label: 'Billing & AI credits',
  },
  notifications: {
    href: '/(app)/notification-settings',
    icon: 'notifications-outline',
    label: 'Notification settings',
  },
  showcaseProfile: {
    href: '/(app)/showcase-profile',
    icon: 'storefront-outline',
    label: 'Public business profile',
  },
  botRules: {
    href: '/(app)/bot-rules',
    icon: 'book-outline',
    label: 'Bot rule book',
  },
  widgets: {
    href: '/(app)/os-widgets',
    icon: 'grid-outline',
    label: 'Home-screen widgets',
  },
  connection: {
    href: '/(app)/connection-check',
    icon: 'pulse-outline',
    label: 'Connection check',
  },
} as const satisfies Record<
  string,
  { href: string; icon: keyof typeof Ionicons.glyphMap; label: string }
>;

export type MenuRouteId = keyof typeof MENU_LINKS;

export const MENU_ROUTE_IDS = Object.keys(MENU_LINKS) as MenuRouteId[];

/**
 * Grouped so one twelve-row wall reads as three short ones: what you
 * work through in a day, what you send out, and the app's own knobs.
 * Within a group, most-opened first.
 */
export const MENU_SECTIONS: { title: string; ids: readonly MenuRouteId[] }[] = [
  {
    title: 'Daily work',
    ids: ['focus', 'gaps', 'deals', 'radar', 'journey', 'dashboard'],
  },
  {
    title: 'Marketing',
    ids: [
      'broadcasts',
      'voiceCampaigns',
      'announcements',
      'greetings',
      'pulse',
      'automations',
    ],
  },
  {
    title: 'App & account',
    ids: [
      'credits',
      'notifications',
      'showcaseProfile',
      'botRules',
      'widgets',
      'connection',
    ],
  },
];

export function isMenuRouteId(value: unknown): value is MenuRouteId {
  return typeof value === 'string' && Object.hasOwn(MENU_LINKS, value);
}

/**
 * Sanitize a persisted favourites list: drop ids this build no longer
 * knows (a downgrade, or a route retired between versions) and dedupe,
 * preserving the order the user pinned them in. Anything that isn't an
 * array at all becomes empty — favourites have no sensible default.
 */
export function normalizeFavorites(stored: unknown): MenuRouteId[] {
  if (!Array.isArray(stored)) return [];
  const seen = new Set<MenuRouteId>();
  for (const value of stored) {
    if (isMenuRouteId(value)) seen.add(value);
  }
  return [...seen];
}

/** Pin or unpin, keeping pin order — newly starred items go last. */
export function toggleFavorite(
  list: MenuRouteId[],
  id: MenuRouteId
): MenuRouteId[] {
  return list.includes(id) ? list.filter((f) => f !== id) : [...list, id];
}

/** Resolve pinned ids to their menu entries, skipping any that no
 *  longer resolve. */
export function favoriteLinks(ids: MenuRouteId[]) {
  return ids.filter(isMenuRouteId).map((id) => ({ id, ...MENU_LINKS[id] }));
}
