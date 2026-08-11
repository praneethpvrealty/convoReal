// ------------------------------------------------------------------
// Copilot API client — the same three endpoints the web helper uses
// (chat, feedback, support tickets), spoken over apiFetch's bearer
// transport. The app always identifies itself as platform 'mobile',
// so every answer carries a coverage verdict the sheet turns into an
// affordance: start a tour, open the desktop web, or ask the support
// team.
// ------------------------------------------------------------------

import { apiFetch } from './api';

export interface CopilotTurn {
  role: 'user' | 'assistant';
  text: string;
}

export type CopilotCoverage = 'full' | 'web_only' | 'partial' | 'none';

export interface CopilotAnswer {
  reply: string;
  tourId?: string;
  navigateTo?: string;
  unsupported?: boolean;
  cached?: boolean;
  cacheId?: string;
  coverage?: CopilotCoverage;
  webUrl?: string;
}

/**
 * The engine reasons in web routes (its knowledge and navigateTo
 * allowlist are the dashboard's), so app pathnames that differ are
 * translated before they travel.
 */
const WEB_PATHNAME: Record<string, string> = {
  '/': '/inbox',
  '/properties': '/inventory',
  '/properties-map': '/inventory',
  '/deals': '/pipelines',
  '/deal-edit': '/pipelines',
  '/favourites': '/dashboard',
  '/more': '/dashboard',
  '/broadcast-new': '/broadcasts',
  '/appointment-new': '/calendar',
};

export function webPathnameFor(pathname: string): string {
  if (WEB_PATHNAME[pathname]) return WEB_PATHNAME[pathname];
  if (pathname.startsWith('/conversation')) return '/inbox';
  if (pathname.startsWith('/contact/')) return '/contacts';
  if (pathname.startsWith('/property')) return '/inventory';
  if (pathname.startsWith('/broadcast/')) return '/broadcasts';
  return pathname;
}

/** Web routes the app can open natively (the reverse map). A route
 *  missing here renders as a desktop-web link instead. */
const APP_HREF: Record<string, string> = {
  '/dashboard': '/(app)/dashboard',
  '/inbox': '/(app)/(tabs)',
  '/contacts': '/(app)/(tabs)/contacts',
  '/inventory': '/(app)/(tabs)/properties',
  '/broadcasts': '/(app)/broadcasts',
  '/calendar': '/(app)/(tabs)/calendar',
  '/pipelines': '/(app)/deals',
  '/journey': '/(app)/journey',
  '/today': '/(app)/today',
  '/radar': '/(app)/radar',
  '/pulse': '/(app)/pulse',
  '/agents': '/(app)/agents',
  '/automations': '/(app)/automations',
};

export function appHrefForWebRoute(route: string | undefined): string | null {
  return (route && APP_HREF[route]) || null;
}

export async function askCopilot(args: {
  message: string;
  pathname: string;
  history: CopilotTurn[];
}): Promise<CopilotAnswer> {
  return apiFetch<CopilotAnswer>('/api/copilot', {
    method: 'POST',
    body: JSON.stringify({
      message: args.message,
      pathname: webPathnameFor(args.pathname),
      history: args.history.slice(-6),
      platform: 'mobile',
    }),
  });
}

/** Fire-and-forget 👍/👎 — feedback must never interrupt the chat. */
export function sendCopilotFeedback(cacheId: string, vote: 'up' | 'down'): void {
  void apiFetch('/api/copilot/feedback', {
    method: 'POST',
    body: JSON.stringify({ cacheId, vote }),
  }).catch(() => {});
}

export async function createSupportTicket(args: {
  question: string;
  helperReply?: string;
  coverage?: CopilotCoverage;
  pathname: string;
  channel: 'whatsapp' | 'email';
  destination: string;
}): Promise<{ id: string; reference: string }> {
  return apiFetch<{ id: string; reference: string }>(
    '/api/copilot/support-ticket',
    {
      method: 'POST',
      body: JSON.stringify({
        question: args.question,
        helper_reply: args.helperReply,
        coverage: args.coverage,
        platform: 'mobile',
        pathname: webPathnameFor(args.pathname),
        channel: args.channel,
        destination: args.destination,
      }),
    }
  );
}
