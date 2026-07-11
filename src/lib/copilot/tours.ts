/**
 * Copilot guided-tour registry.
 *
 * Tours are fully deterministic — no AI involved. Each tour is an
 * ordered list of steps; a step points at an element tagged with a
 * `data-tour` attribute somewhere in the dashboard, and the engine
 * (copilot-context.tsx) spotlights it, waits for the user to act,
 * then advances. Keeping this as plain data means tours are
 * unit-testable in node and the AI layer can reference them by id
 * without ever generating steps itself.
 */

export type AdvanceOn = 'click-target' | 'next' | 'route-change';

export interface TourStep {
  /** Pathname this step lives on, e.g. '/contacts'. */
  route: string;
  /** 'exact' (default) or 'prefix' pathname matching. Use 'prefix'
   *  with route '/' for steps reachable from anywhere (sidebar nav). */
  routeMatch?: 'exact' | 'prefix';
  /** Required query params, e.g. { tab: 'pulse' } for dashboard tabs. */
  query?: Record<string, string>;
  /** data-tour attribute value of the element to spotlight. */
  target: string;
  title: string;
  body: string;
  advanceOn: AdvanceOn;
  /** Skip this step when the NEXT step's route already matches —
   *  e.g. "click Contacts in the menu" while already on /contacts. */
  skipIfNextRouteActive?: boolean;
  /** Target lives in the sidebar — open the mobile drawer first. */
  requiresSidebar?: boolean;
}

export interface Tour {
  id: string;
  title: string;
  /** One-liner for the Guides list and the AI tour catalog. */
  description: string;
  /** Phrasings (English / Hindi / Hinglish) the deterministic intent
   *  matcher checks before any AI call is made. */
  triggers: RegExp[];
  steps: TourStep[];
}

/** Step reachable from any dashboard page. */
const ANYWHERE = { route: '/', routeMatch: 'prefix' as const };

export const TOURS: Tour[] = [
  {
    id: 'add-contact',
    title: 'Add a contact',
    description: 'Save a new lead or customer with their phone number',
    triggers: [
      /add.{0,20}(contact|lead|customer)/i,
      /(contact|lead|customer).{0,20}(add|create|save|kaise|kese|banau|banao|jodo)/i,
      /naya (lead|contact|customer)/i,
      /new (lead|contact|customer)/i,
    ],
    steps: [
      {
        ...ANYWHERE,
        target: 'nav-contacts',
        title: 'Open Contacts',
        body: 'All your leads and customers live here. Click **Contacts** in the menu.',
        advanceOn: 'click-target',
        skipIfNextRouteActive: true,
        requiresSidebar: true,
      },
      {
        route: '/contacts',
        target: 'add-contact',
        title: 'Add your contact',
        body: 'Click the **Add Contact** button.',
        advanceOn: 'click-target',
      },
      {
        route: '/contacts',
        target: 'add-contact',
        title: 'Almost done!',
        body: 'Fill in the name and WhatsApp number, then press Save. That’s it! \u{1F389}',
        advanceOn: 'next',
      },
    ],
  },
  {
    id: 'add-property',
    title: 'Add a property',
    description: 'List a new property with price, location and photos',
    triggers: [
      /add.{0,20}(property|listing|flat|plot|villa|house)/i,
      /(property|listing|makaan|ghar).{0,20}(add|create|list|kaise|kese|dalu|dalo|jodo)/i,
      /nay[ai] (property|listing)/i,
      /new (property|listing)/i,
    ],
    steps: [
      {
        ...ANYWHERE,
        target: 'nav-inventory',
        title: 'Open Inventory',
        body: 'Your properties live in **Inventory**. Click it in the menu.',
        advanceOn: 'click-target',
        skipIfNextRouteActive: true,
        requiresSidebar: true,
      },
      {
        route: '/inventory',
        target: 'add-property',
        title: 'Add your property',
        body: 'Click the **Add Property** button.',
        advanceOn: 'click-target',
      },
      {
        route: '/inventory',
        target: 'add-property',
        title: 'Almost done!',
        body: 'Add the price, location and photos, then press Save. Buyers see exactly what you enter here.',
        advanceOn: 'next',
      },
    ],
  },
  {
    id: 'connect-whatsapp',
    title: 'Connect WhatsApp',
    description: 'Link your WhatsApp Business number to unlock chats and broadcasts',
    triggers: [
      /connect.{0,20}whatsapp/i,
      /whatsapp.{0,20}(setup|set up|connect|link|jodo|lagao|kaise|kese)/i,
      /(set ?up|link).{0,15}whatsapp/i,
    ],
    steps: [
      {
        ...ANYWHERE,
        target: 'nav-settings',
        title: 'Open Settings',
        body: 'WhatsApp setup is in **Settings**. Click it at the bottom of the menu.',
        advanceOn: 'click-target',
        skipIfNextRouteActive: true,
        requiresSidebar: true,
      },
      {
        route: '/settings',
        routeMatch: 'prefix',
        target: 'settings-tab-whatsapp',
        title: 'Go to the WhatsApp tab',
        body: 'Click the **WhatsApp** tab.',
        advanceOn: 'click-target',
      },
      {
        route: '/settings',
        routeMatch: 'prefix',
        query: { tab: 'whatsapp' },
        target: 'whatsapp-config-form',
        title: 'Enter your details',
        body: 'Enter the details from your Meta Business account here, then press Save. Once connected, every customer message lands in your Inbox.',
        advanceOn: 'next',
      },
    ],
  },
  {
    id: 'send-broadcast',
    title: 'Send a broadcast',
    description: 'Send one WhatsApp message to many contacts at once',
    triggers: [
      /(send|create|new).{0,20}broadcast/i,
      /broadcast.{0,20}(send|kaise|kese|bhejo|karo)/i,
      /(message|msg).{0,20}(many|multiple|all|sab|sabko|bulk)/i,
      /(sabko|sab ko|bulk|ek saath).{0,20}(message|msg|bhej|send)/i,
      /bulk.{0,10}(message|msg|send)/i,
    ],
    steps: [
      {
        ...ANYWHERE,
        target: 'nav-broadcasts',
        title: 'Open Broadcasts',
        body: 'Send one message to many people from **Broadcasts**. Click it in the menu.',
        advanceOn: 'click-target',
        skipIfNextRouteActive: true,
        requiresSidebar: true,
      },
      {
        route: '/broadcasts',
        target: 'new-broadcast',
        title: 'Start a new broadcast',
        body: 'Click **New Broadcast**.',
        advanceOn: 'click-target',
      },
      {
        route: '/broadcasts/new',
        target: 'broadcast-steps',
        title: 'Just follow the steps',
        body: 'Follow these 4 steps — pick a template, choose people, personalise, and send. WhatsApp only allows approved templates for broadcasts.',
        advanceOn: 'next',
      },
    ],
  },
  {
    id: 'check-property-views',
    title: 'See who viewed your properties',
    description: 'Check visitor activity on your property links (Pulse)',
    triggers: [
      /who.{0,15}(saw|viewed|seen|watch)/i,
      /(property|properties|listing).{0,25}(views?|viewed|dekha|dekhe)/i,
      /(views?|visitors?).{0,20}(property|properties|listing|check|dekh)/i,
      /kitne log.{0,20}dekh/i,
      /\bpulse\b/i,
    ],
    steps: [
      {
        ...ANYWHERE,
        target: 'nav-dashboard',
        title: 'Open the Dashboard',
        body: 'Let’s check your visitor activity. Click **Dashboard** in the menu.',
        advanceOn: 'click-target',
        skipIfNextRouteActive: true,
        requiresSidebar: true,
      },
      {
        route: '/dashboard',
        target: 'dashboard-tab-pulse',
        title: 'Open Pulse',
        body: 'Click the **Pulse** tab.',
        advanceOn: 'click-target',
      },
      {
        route: '/dashboard',
        query: { tab: 'pulse' },
        target: 'dashboard-tab-pulse',
        title: 'Your visitor activity',
        body: 'Every time someone opens your property links on WhatsApp, it shows here — total views, time spent, and your most popular properties. \u{1F440}',
        advanceOn: 'next',
      },
    ],
  },
];

export function getTour(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}
