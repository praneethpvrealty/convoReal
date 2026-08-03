'use client';

// Buyer-side Portfolio first-run welcome. Buyers land here from a
// WhatsApp link their consultant sent — this explains what the portal
// is before they see a single screen.

import {
  Heart,
  MessageCircle,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';

import { useBuyer } from '@/components/buyer/buyer-provider';
import { PortalWelcome } from '@/components/onboarding/portal-welcome';

export function BuyerWelcome() {
  const { me } = useBuyer();
  if (!me) return null;

  const agency = me.links.find((l) => l.agency_name)?.agency_name;

  return (
    <PortalWelcome
      storageKey={`buyer_welcome_seen_${me.buyer_user_id}`}
      mediaSlug="buyer-welcome"
      doneLabel="See my shortlist"
      steps={[
        {
          icon: <Heart className="text-primary h-7 w-7" />,
          title: 'Welcome to your Portfolio',
          body: `${agency || 'Your property consultant'} set up this private space for your home search. Your shortlist, your preferences, and new matches — all in one place, free.`,
        },
        {
          icon: <SlidersHorizontal className="text-primary h-7 w-7" />,
          title: 'Tell us what you’re looking for',
          body: 'Set your budget, areas and must-haves under Preferences. The more you tell us, the better every match gets — it takes two minutes.',
        },
        {
          icon: <Sparkles className="text-primary h-7 w-7" />,
          title: 'Matches find you',
          body: 'When a property that fits your preferences comes in, it appears under Matches — often before it’s advertised anywhere else.',
        },
        {
          icon: <MessageCircle className="text-primary h-7 w-7" />,
          title: 'Alerts on WhatsApp',
          body: 'Good matches also reach you on WhatsApp, so you won’t miss the right home by not checking an app. Switch alerts on or off in Settings.',
        },
      ]}
    />
  );
}
