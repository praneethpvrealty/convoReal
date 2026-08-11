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

export type MobileAdvanceOn = 'press-target' | 'next';

/**
 * A tour step for the Expo app. Unlike web steps the native engine
 * navigates itself (router.push on `screen`), so there are no nav
 * steps and no route matching modes — just spotlight and advance.
 * The app keeps a hand-ported copy of these (mobile/lib/copilot-tours.ts,
 * guarded by src/lib/mobile-parity.test.ts); the server reads them to
 * know which tours may start on the app at all.
 */
export interface MobileTourStep {
  /** Expo Router href the engine navigates to before spotlighting. */
  screen: string;
  /** Registered tour-target id on that screen. */
  target: string;
  title: string;
  body: string;
  advanceOn: MobileAdvanceOn;
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
  /** Present only when the whole task can be walked through in the
   *  mobile app. A tour without them is desktop-web only there. */
  mobileSteps?: MobileTourStep[];
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
    mobileSteps: [
      {
        screen: '/(app)/(tabs)/contacts',
        target: 'add-contact',
        title: 'Add your contact',
        body: 'This is the **Add contact** button — tap it to save a new lead.',
        advanceOn: 'press-target',
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
    description:
      'Link your WhatsApp Business number to unlock chats and broadcasts',
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
    mobileSteps: [
      {
        screen: '/(app)/broadcasts',
        target: 'new-broadcast',
        title: 'Start a new broadcast',
        body: 'Tap **New broadcast** at the top.',
        advanceOn: 'press-target',
      },
      {
        screen: '/(app)/broadcast-new',
        target: 'broadcast-compose',
        title: 'Just follow the steps',
        body: 'Pick a template, choose people, personalise, and send. WhatsApp only allows approved templates for broadcasts.',
        advanceOn: 'next',
      },
    ],
  },
  {
    id: 'submit-templates',
    title: 'Use your ready-made templates',
    description:
      'Submit the pre-loaded WhatsApp templates to Meta and see where they work for you',
    triggers: [
      /(submit|approve|use|send).{0,25}template/i,
      /template.{0,25}(submit|approve|use|draft|kaise|kese|bhejo|karo)/i,
      /(draft|ready.?made|pre.?loaded|imported).{0,20}template/i,
      /(appointment|visit).{0,20}reminder/i,
    ],
    steps: [
      {
        ...ANYWHERE,
        target: 'nav-settings',
        title: 'Open Settings',
        body: 'Templates live in **Settings**. Click it at the bottom of the menu.',
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
        target: 'settings-tab-templates',
        title: 'Open Templates',
        body: 'Click the **Templates** tab.',
        advanceOn: 'click-target',
      },
      {
        route: '/settings',
        routeMatch: 'prefix',
        query: { tab: 'whatsapp', sub: 'templates' },
        target: 'template-manager',
        title: 'Your ready-made templates',
        body: 'These came pre-loaded with your account. Anything marked **Draft** hasn’t gone to Meta yet — open it and press **Submit for approval**. Once approved, appointment and site-visit reminders send automatically, and Broadcasts can use them. ✅',
        advanceOn: 'next',
      },
    ],
  },
  {
    id: 'email-lead-sync',
    title: 'Get portal leads by email',
    description:
      'Forward 99acres, MagicBricks and Housing lead emails into ConvoReal automatically',
    triggers: [
      /(email|portal).{0,25}lead/i,
      /lead.{0,25}(email|portal|forward|sync)/i,
      /(99 ?acres|magic ?bricks|housing\.com)/i,
      /(email|mail).{0,20}(forward|sync|jodo|lagao|kaise|kese)/i,
    ],
    steps: [
      {
        ...ANYWHERE,
        target: 'nav-settings',
        title: 'Open Settings',
        body: 'Email lead setup is in **Settings**. Click it at the bottom of the menu.',
        advanceOn: 'click-target',
        skipIfNextRouteActive: true,
        requiresSidebar: true,
      },
      {
        route: '/settings',
        routeMatch: 'prefix',
        target: 'settings-tab-other',
        title: 'Go to the Other tab',
        body: 'Click the **Other** tab.',
        advanceOn: 'click-target',
      },
      {
        route: '/settings',
        routeMatch: 'prefix',
        query: { tab: 'other' },
        target: 'email-lead-sourcing',
        title: 'Your lead forwarding address',
        body: 'Copy this address, then add a forwarding rule in your Gmail or Outlook for emails from 99acres, MagicBricks or Housing — the step-by-step guide is right below. Once the rule is on, every portal lead becomes a WhatsApp contact automatically. \u{1F4E9}',
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
    mobileSteps: [
      {
        screen: '/(app)/pulse',
        target: 'pulse-feed',
        title: 'Your visitor activity',
        body: 'Every time someone opens your property links on WhatsApp, it shows here — total views, time spent, and your most popular properties. \u{1F440}',
        advanceOn: 'next',
      },
    ],
  },
  {
    id: 'share-requirement',
    title: 'Share a requirement with another broker',
    description:
      'Send a client’s requirement to other agents and collect matching listings back',
    triggers: [
      /share.{0,25}(requirement|brief|demand)/i,
      /(requirement|brief|demand).{0,25}(share|send|bhejo|bhejna|kaise|kese)/i,
      /co.?broker/i,
      /(other|another|fellow).{0,15}(agent|broker).{0,30}(requirement|listing|inventory)/i,
    ],
    steps: [
      {
        ...ANYWHERE,
        target: 'nav-contacts',
        title: 'Open Contacts',
        body: 'Client requirements live under **Contacts**. Click it in the menu.',
        advanceOn: 'click-target',
        skipIfNextRouteActive: true,
        requiresSidebar: true,
      },
      {
        route: '/contacts',
        target: 'contacts-tab-requirements',
        title: 'Go to Requirements',
        body: 'Click the **Requirements** tab to see every client brief.',
        advanceOn: 'click-target',
        skipIfNextRouteActive: true,
      },
      {
        route: '/contacts',
        query: { tab: 'requirements' },
        target: 'share-requirement',
        title: 'Share the brief',
        body: 'Click the **share** icon on any requirement card. To send several at once, tick the cards first and use **Share with brokers** at the top.',
        advanceOn: 'click-target',
      },
      {
        route: '/contacts',
        query: { tab: 'requirements' },
        target: 'share-requirement',
        title: 'Masked or full detail?',
        body: '**Masked** is the safe default — the other broker sees the budget and locality under a code like REQ-A3F2, never your client’s name or your notes. Pick **Full detail** only for someone inside your own firm.',
        advanceOn: 'next',
      },
      {
        route: '/contacts',
        query: { tab: 'requirements' },
        target: 'share-requirement',
        title: 'Send it and collect listings',
        body: 'Keep **Interactive response links** on, then press **Send on WhatsApp**. The broker gets a link where they can send you a matching property — it arrives in Inventory under **Review** for you to approve. \u{1F91D}',
        advanceOn: 'next',
      },
    ],
  },
];

export function getTour(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}

export function tourSupportsMobile(id: string): boolean {
  const tour = getTour(id);
  return !!tour?.mobileSteps?.length;
}

/** First page a desktop-only tour lands on — the "open on desktop"
 *  link the app hands out when a tour can't run natively. */
export function tourWebEntryRoute(tour: Tour): string {
  return tour.steps.find((s) => s.route !== '/')?.route ?? '/dashboard';
}
