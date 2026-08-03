'use client';

// Owner-side Portfolio first-run welcome. Owners land here from a
// WhatsApp link their consultant sent — this explains what the portal
// is before they see a single screen.

import { Building2, HandCoins, KeyRound, MessageCircle } from 'lucide-react';

import { useDen } from '@/components/den/den-provider';
import { PortalWelcome } from '@/components/onboarding/portal-welcome';

export function DenWelcome() {
  const { me } = useDen();
  if (!me) return null;

  const agency = me.links.find((l) => l.agency_name)?.agency_name;

  return (
    <PortalWelcome
      storageKey={`den_welcome_seen_${me.den_user_id}`}
      mediaSlug="den-welcome"
      doneLabel="Open my Portfolio"
      steps={[
        {
          icon: <KeyRound className="text-primary h-7 w-7" />,
          title: 'Welcome to your Portfolio',
          body: `${agency || 'Your property consultant'} set up this private space for you. Everything about your properties — interest, offers, progress — lives here, and it's free.`,
        },
        {
          icon: <Building2 className="text-primary h-7 w-7" />,
          title: 'Your properties, always current',
          body: 'Every property you’ve listed with your consultant appears under My Properties, with its live status. No more calling to ask "any update?" — the update is already here.',
        },
        {
          icon: <HandCoins className="text-primary h-7 w-7" />,
          title: 'Offers come straight to you',
          body: 'When a buyer makes an offer, it lands in Offers. You see the amount and respond in a tap — accept, counter, or decline. Your consultant handles everything after that.',
        },
        {
          icon: <MessageCircle className="text-primary h-7 w-7" />,
          title: 'Updates on WhatsApp',
          body: 'Matches and offer news also reach you on WhatsApp, so you never need to remember to check. You can change how often in Settings.',
        },
      ]}
    />
  );
}
