// ------------------------------------------------------------------
// Home widgets — pure registry + list operations (no RN imports, so
// this module stays testable under the plain Node vitest runner).
// Which screens a user pins to their Overview dashboard, in order.
// ------------------------------------------------------------------

export const WIDGET_IDS = [
  'inbox',
  'calendar',
  'contacts',
  'properties',
  'deals',
  'broadcasts',
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

export interface HomeWidgetDef {
  id: WidgetId;
  label: string;
  description: string;
}

export const WIDGET_DEFS: Record<WidgetId, HomeWidgetDef> = {
  inbox: {
    id: 'inbox',
    label: 'Inbox',
    description: 'Unread and open WhatsApp chats',
  },
  calendar: {
    id: 'calendar',
    label: 'Calendar',
    description: "Today's appointments at a glance",
  },
  contacts: {
    id: 'contacts',
    label: 'Contacts',
    description: 'Your book of leads and hot prospects',
  },
  properties: {
    id: 'properties',
    label: 'Properties',
    description: 'Available listings in your inventory',
  },
  deals: {
    id: 'deals',
    label: 'Deals',
    description: 'Open pipeline value and deal count',
  },
  broadcasts: {
    id: 'broadcasts',
    label: 'Broadcasts',
    description: 'Delivery of your latest campaign',
  },
};

export const DEFAULT_WIDGETS: WidgetId[] = ['inbox', 'calendar'];

export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === 'string' && (WIDGET_IDS as readonly string[]).includes(value);
}

/** Sanitize a persisted selection: drop unknown ids (older/newer app
 *  versions may have stored widgets this build doesn't know) and
 *  dedupe. Anything that isn't an array at all falls back to the
 *  defaults — an intentionally emptied list stays empty. */
export function normalizeWidgetIds(stored: unknown): WidgetId[] {
  if (!Array.isArray(stored)) return [...DEFAULT_WIDGETS];
  const seen = new Set<WidgetId>();
  for (const value of stored) {
    if (isWidgetId(value)) seen.add(value);
  }
  return [...seen];
}

export function addWidget(list: WidgetId[], id: WidgetId): WidgetId[] {
  return list.includes(id) ? list : [...list, id];
}

export function removeWidget(list: WidgetId[], id: WidgetId): WidgetId[] {
  return list.filter((w) => w !== id);
}

export function moveWidget(
  list: WidgetId[],
  id: WidgetId,
  direction: 'up' | 'down'
): WidgetId[] {
  const from = list.indexOf(id);
  if (from < 0) return list;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Widgets not yet on the dashboard, in registry order. */
export function availableWidgets(list: WidgetId[]): WidgetId[] {
  return WIDGET_IDS.filter((id) => !list.includes(id));
}

/** Android AppWidget provider names — must match `widgets[].name` in the
 *  react-native-android-widget plugin config in app.json. */
export const OS_WIDGET_NAMES: Record<WidgetId, string> = {
  inbox: 'Inbox',
  calendar: 'Calendar',
  contacts: 'Contacts',
  properties: 'Properties',
  deals: 'Deals',
  broadcasts: 'Broadcasts',
};

export function widgetIdForOsName(name: string): WidgetId | null {
  return WIDGET_IDS.find((id) => OS_WIDGET_NAMES[id] === name) ?? null;
}

/** App path a home-screen widget tap deep-links to. Every path here must
 *  survive the rewriter in app/+native-intent.ts. */
export const WIDGET_DEEP_LINKS: Record<WidgetId, string> = {
  inbox: '/',
  calendar: '/calendar',
  contacts: '/contacts',
  properties: '/properties',
  deals: '/deals',
  broadcasts: '/broadcasts',
};
