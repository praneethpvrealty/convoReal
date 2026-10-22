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
        body: 'Write your message, choose people, and send. ConvoReal picks the approved WhatsApp template for you, so there is nothing to choose.',
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
  {
    id: 'use-inbox',
    title: 'Reply to customers in the Inbox',
    description:
      'Find every WhatsApp chat in one place, filter what needs a reply, and answer',
    steps: [
      {
        screen: '/(app)/(tabs)',
        target: 'inbox-search',
        title: 'Your conversations',
        body: 'Every WhatsApp chat with a customer lands here, newest first. Search by name, phone or message to find one quickly.',
        advanceOn: 'next',
      },
      {
        screen: '/(app)/(tabs)',
        target: 'inbox-filters',
        title: 'Find what needs a reply',
        body: 'Tap **Needs reply** or **Unread** to see only the chats waiting on you, then open a chat and type your reply at the bottom. \u{1F4AC}',
        advanceOn: 'next',
      },
    ],
  },
  {
    id: 'track-deals',
    title: 'Track a deal on the board',
    description:
      'Add a deal for a buyer and move it across pipeline stages as it progresses',
    steps: [
      {
        screen: '/(app)/deals',
        target: 'deals-stages',
        title: 'Your pipeline stages',
        body: 'Each stage shows how many deals sit in it and their value. Tap a stage to jump to its cards.',
        advanceOn: 'next',
      },
      {
        screen: '/(app)/deals',
        target: 'new-deal',
        title: 'Add a deal',
        body: 'Tap **+** to put a buyer and a property on the board. Long-press any card later to move it to the next stage.',
        advanceOn: 'press-target',
      },
    ],
  },
  {
    id: 'schedule-visit',
    title: 'Schedule a site visit',
    description:
      'Book a site visit or meeting on the calendar with automatic WhatsApp reminders',
    steps: [
      {
        screen: '/(app)/(tabs)/calendar',
        target: 'new-appointment',
        title: 'Schedule a visit',
        body: 'Tap **+** to book a site visit or meeting.',
        advanceOn: 'press-target',
      },
      {
        screen: '/(app)/appointment-new',
        target: 'appointment-form',
        title: 'Reminders go out by themselves',
        body: 'Pick the contact, the property, the date and the time, then save. The customer gets a WhatsApp reminder before the visit automatically. \u{1F4C5}',
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
