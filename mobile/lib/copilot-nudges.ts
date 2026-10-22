// ------------------------------------------------------------------
// Pure half of the mobile nudge hook (use-copilot-nudges.ts): storage
// key names and how a nudge's call to action resolves on the phone.
// The cooldown arithmetic itself is shared with the web hook through
// @shared/lib/copilot/nudge-pick. The web-route → app-href map lives
// in copilot.ts, which reaches Expo, so the widget hands it in.
// ------------------------------------------------------------------

import { getTour, tourWebEntryRoute } from '@shared/lib/copilot/tours';

import { getMobileTour } from './copilot-tours';

export interface CopilotNudgeCta {
  label: string;
  href?: string;
  tourId?: string;
}

export interface CopilotNudge {
  id: string;
  priority: number;
  message: string;
  cta?: CopilotNudgeCta;
}

export function nudgeLastShownKey(accountId: string): string {
  return `copilot-nudge-last-shown:${accountId}`;
}

export function nudgeSeenKey(accountId: string): string {
  return `copilot-nudge-seen:${accountId}`;
}

export type NudgeCtaTarget =
  | { kind: 'tour'; tourId: string }
  | { kind: 'app'; href: string }
  | { kind: 'web'; path: string };

/** Where a nudge's button goes on the phone: a native tour when the
 *  registry ports one, a native screen when the web route maps to one,
 *  else the desktop web page. */
export function nudgeCtaTarget(
  cta: CopilotNudgeCta,
  appHrefForWebRoute: (route: string) => string | null
): NudgeCtaTarget | null {
  if (cta.tourId) {
    if (getMobileTour(cta.tourId)) return { kind: 'tour', tourId: cta.tourId };
    const tour = getTour(cta.tourId);
    return { kind: 'web', path: tour ? tourWebEntryRoute(tour) : '/dashboard' };
  }
  if (cta.href) {
    const href =
      appHrefForWebRoute(cta.href) ??
      appHrefForWebRoute(cta.href.split('?')[0]);
    if (href) return { kind: 'app', href };
    return { kind: 'web', path: cta.href };
  }
  return null;
}
