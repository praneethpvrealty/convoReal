/**
 * Platform awareness for the helper.
 *
 * The same engine answers the web dashboard and the Expo app, but the
 * two surfaces can do different things: the app covers the daily
 * field-work screens while setup and builders live on desktop web.
 * When the app asks a question, the model classifies its own answer
 * with a `coverage` verdict so the client can attach the right
 * affordance — start an in-app tour, hand over a desktop link, or
 * offer the support team.
 *
 * Only the staff (`agent`) audience has a mobile app; portals are
 * web-only and never send a platform.
 */

export type CopilotPlatform = 'web' | 'mobile';

/**
 * How much of the answer the user can act on where they are.
 *  - full:     everything works inside the mobile app
 *  - web_only: ConvoReal does it, but on the desktop web dashboard
 *  - partial:  some of it works in the app, the rest needs desktop
 *              (or a human) — the client offers the support team
 *  - none:     the helper cannot help — the client offers the
 *              support team
 */
export type MobileCoverage = 'full' | 'web_only' | 'partial' | 'none';

const COVERAGES: readonly MobileCoverage[] = [
  'full',
  'web_only',
  'partial',
  'none',
];

export function parsePlatform(value: unknown): CopilotPlatform {
  return value === 'mobile' ? 'mobile' : 'web';
}

export function parseCoverage(value: unknown): MobileCoverage | null {
  return typeof value === 'string' &&
    (COVERAGES as readonly string[]).includes(value)
    ? (value as MobileCoverage)
    : null;
}

/** Absolute dashboard URL for a "do this on desktop" handoff. */
export function webUrlFor(path?: string | null): string {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://www.convoreal.com'
  ).replace(/\/$/, '');
  return path && path.startsWith('/') ? `${base}${path}` : base;
}

/**
 * Web routes the mobile app has a screen for. Drives the scaffold's
 * mobile directory and lets the engine keep `navigateTo` meaningful
 * on the app (the client maps these to Expo Router screens).
 */
export const MOBILE_APP_ROUTES: readonly string[] = [
  '/dashboard',
  '/inbox',
  '/contacts',
  '/inventory',
  '/broadcasts',
  '/calendar',
  '/pipelines',
  '/journey',
  '/today',
  '/radar',
  '/pulse',
  '/agents',
  '/automations',
];

/**
 * Scaffold section appended for mobile questions. Part of the mobile
 * KB hash — editing it retires the mobile answer cache, never the web
 * one.
 */
export const MOBILE_APP_SECTION = [
  'MOBILE APP: The user is in the ConvoReal mobile app, not the web dashboard. The app covers: Inbox chats, Contacts (add, edit, import from the phone book), Properties (view, edit, share, map view with a GPS "Near me" filter — ADDING a property is desktop-web only), Broadcasts, Calendar, Deals, Journey, Today, Match Radar, Pulse, Team, Automations (view and pause only), Billing & AI credits, Notifications, home-screen widgets and app lock. Everything else — Settings (WhatsApp connection, templates, email lead sync, showcase), the Automations and Flows builders, Liaisons, Ads, Requirements sharing — is desktop web only.',
  'Classify every reply with coverage:',
  '- "full": the user can do the whole thing inside the mobile app. Give app steps.',
  '- "web_only": ConvoReal does it, but only on the desktop web dashboard. Say so, name the page, and set navigateTo to that web page.',
  '- "partial": part works in the app, the rest needs the desktop web. Explain the app part first, then what remains.',
  '- "none": you cannot help with this. The app will offer the ConvoReal support team.',
].join('\n');

export const MOBILE_COVERAGE_CONTRACT =
  'coverage is required: "full", "web_only", "partial" or "none" as defined above.';
