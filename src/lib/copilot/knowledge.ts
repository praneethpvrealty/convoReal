import { TOURS } from './tours';

/**
 * Compact, hand-written knowledge base injected into the copilot
 * system prompt. Keep entries to 2–4 plain sentences: the whole
 * prompt must stay small (budget-tested in knowledge.test.ts)
 * because the operator pays per token for every free-form question.
 */
export const PAGE_KNOWLEDGE: Record<string, string> = {
  '/dashboard':
    'Home screen with four tabs. Overview: key numbers (contacts, properties, deals, messages). Today: daily action list — WhatsApp chats about to close, hot leads going quiet, appointments and to-dos. Match Radar: automatic buyer-to-property matches. Pulse: who viewed your property links, how many times, and for how long.',
  '/contacts':
    'All your leads and customers. Add contacts manually, import them, or let the WhatsApp bot capture them automatically. Each contact stores phone, budget, preferred locations, property type, and a lead temperature (HOT/WARM/COLD). Forwarding a customer’s message card to your own WhatsApp bot also saves them.',
  '/inventory':
    'Your property listings with price, location, photos and documents. Properties here power buyer matching (Match Radar), your public Showcase portal link, and AI-generated descriptions. Use Share Showcase Portal to send buyers a link to browse your listings.',
  '/calendar':
    'Appointments and to-dos. Site visits, follow-up reminders and tasks appear here and in the Today tab. You can link an appointment to a contact and a property.',
  '/inbox':
    'All WhatsApp conversations with your customers in one place. Reply within WhatsApp’s 24-hour window; after it closes you must use an approved template. Unread chats show a dot in the menu.',
  '/automations':
    'Set-and-forget rules, like auto-replies and follow-up sequences that trigger on events (new lead, keyword, time delay).',
  '/broadcasts':
    'Send one approved WhatsApp template message to many contacts at once — pick a template, choose the audience (all or by tag), personalise, and send. Delivery and read counts are tracked per broadcast.',
  '/pipelines':
    'Deal board. Drag deals between stages (new, negotiating, closed) to track every potential sale from first chat to closing.',
  '/flows':
    'Visual chatbot flow builder — design question-and-answer paths the WhatsApp bot follows with customers.',
  '/requirements':
    'Buyer requirements collected from customers (budget, location, property type). These drive Match Radar suggestions.',
  '/agents':
    'Other agents you collaborate with, for sharing inventory and requirements.',
  '/ads':
    'Create and track Meta (Facebook/Instagram) ads for your properties, with AI-written ad copy.',
  '/settings':
    'Profile, WhatsApp connection (Meta Business credentials), message templates, tags, Showcase branding, AI credits and billing. WhatsApp must be connected before Inbox and Broadcasts work.',
};

/** Compact tour catalog for the system prompt. */
export function buildTourCatalog(): string {
  return TOURS.map((t) => `- ${t.id}: ${t.description}`).join('\n');
}

const ROUTE_ALLOWLIST = Object.keys(PAGE_KNOWLEDGE);

export function isAllowedRoute(path: string): boolean {
  return ROUTE_ALLOWLIST.includes(path);
}

/** Longest-prefix knowledge lookup, so '/broadcasts/new' → '/broadcasts'. */
export function knowledgeForPath(pathname: string): string | null {
  if (PAGE_KNOWLEDGE[pathname]) return PAGE_KNOWLEDGE[pathname];
  const hit = ROUTE_ALLOWLIST.filter((r) => pathname.startsWith(r)).sort(
    (a, b) => b.length - a.length,
  )[0];
  return hit ? PAGE_KNOWLEDGE[hit] : null;
}

export function buildCopilotSystemPrompt(pathname: string): string {
  const pages = Object.entries(PAGE_KNOWLEDGE)
    .map(([route, desc]) => `${route}: ${desc}`)
    .join('\n');
  const current = knowledgeForPath(pathname);

  return [
    'You are the friendly in-app helper for ConvoReal, a WhatsApp CRM for Indian real-estate agents. Many users are not tech-savvy — explain simply, no jargon.',
    'Rules:',
    '- Reply in the SAME language the user wrote in (English, Hindi, or Hinglish).',
    '- Keep replies under 3 short sentences.',
    '- Never invent features. Only discuss ConvoReal using the knowledge below. If asked anything unrelated, politely steer back to ConvoReal.',
    '',
    'APP PAGES:',
    pages,
    '',
    'GUIDED TOURS — if the user asks HOW to do one of these, set tourId to start an on-screen walkthrough instead of explaining in words:',
    buildTourCatalog(),
    '',
    `CURRENT PAGE: The user is on ${pathname}.${current ? ` About this page: ${current}` : ''}`,
    '',
    'Respond ONLY with JSON in exactly this shape:',
    '{"reply": string, "tourId": string or null, "navigateTo": string or null}',
    `navigateTo, when set, must be one of: ${ROUTE_ALLOWLIST.join(', ')}. Set it only when the user asks to go somewhere and no tour fits.`,
  ].join('\n');
}
