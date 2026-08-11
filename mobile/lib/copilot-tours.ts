// Port of the mobileSteps declared in the web repo's
// src/lib/copilot/tours.ts — the guided tours that can run natively.
// Kept in sync by the web repo's src/lib/mobile-parity.test.ts.

export type MobileAdvanceOn = 'press-target' | 'next';

export interface MobileTourStep {
  /** Expo Router href the engine navigates to before spotlighting. */
  screen: string;
  /** TourTarget id registered on that screen. */
  target: string;
  title: string;
  body: string;
  advanceOn: MobileAdvanceOn;
}

export interface MobileTour {
  id: string;
  title: string;
  description: string;
  steps: MobileTourStep[];
}

export const MOBILE_TOURS: MobileTour[] = [
  {
    id: 'add-contact',
    title: 'Add a contact',
    description: 'Save a new lead or customer with their phone number',
    steps: [
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
    id: 'send-broadcast',
    title: 'Send a broadcast',
    description: 'Send one WhatsApp message to many contacts at once',
    steps: [
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
    id: 'check-property-views',
    title: 'See who viewed your properties',
    description: 'Check visitor activity on your property links (Pulse)',
    steps: [
      {
        screen: '/(app)/pulse',
        target: 'pulse-feed',
        title: 'Your visitor activity',
        body: 'Every time someone opens your property links on WhatsApp, it shows here — total views, time spent, and your most popular properties. \u{1F440}',
        advanceOn: 'next',
      },
    ],
  },
];

export function getMobileTour(id: string): MobileTour | undefined {
  return MOBILE_TOURS.find((t) => t.id === id);
}

/** '/(app)/(tabs)/contacts' → '/contacts', matching what expo-router's
 *  usePathname() reports (group segments stripped). */
export function screenPathname(screen: string): string {
  const stripped = screen
    .split('/')
    .filter((seg) => seg && !seg.startsWith('('))
    .join('/');
  return `/${stripped}`;
}
