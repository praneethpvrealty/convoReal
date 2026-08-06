// ============================================================
// The staff-facing help card for the WhatsApp assistant — what the
// account's own number can do when an owner/agent texts it.
//
// Two messages, because the same code path served both jobs and the
// copy could only suit one: an explicit "help"/greeting gets the full
// capability guide, while an unrecognized message gets a short nudge
// with the three most likely intents. Sending the whole guide every
// time a forward failed to classify buried the one line that mattered.
//
// Formatting is WhatsApp's, not Markdown: *bold* takes single
// asterisks and _italics_ underscores. The old card used `**Cancel**`,
// which renders literally.
//
// STAFF ONLY, by construction: the sole caller is
// processOwnerChatbotMessage, which webhook-handler invokes behind
// `checkIsAccountOwner(senderPhone, accountId)`. Leads and property
// owners never see either message and must not — they get the flows
// engine / buyer chatbot instead. Keep any new caller inside that gate:
// the greeting words below ("hi", "hello", "namaste") are exactly how a
// lead opens a conversation, so an ungated caller would answer buyers
// with an Engine manual.
// ============================================================

import { BRANDING } from '@/config/branding';

/** Whole-message inputs that mean "show me what you can do". */
const HELP_COMMANDS = new Set([
  'help',
  'menu',
  'commands',
  'start',
  'hi',
  'hello',
  'hey',
  'hii',
  'namaste',
]);

export function isOwnerHelpCommand(text: string | null | undefined): boolean {
  const t = (text ?? '').trim().toLowerCase().replace(/[!.?]+$/, '');
  return HELP_COMMANDS.has(t);
}

function dashboardUrl(): string {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    BRANDING.websiteUrl ||
    ''
  ).replace(/\/+$/, '');
  return base ? `${base}/dashboard` : '';
}

/**
 * The full guide. Every section is something the inbound handler
 * actually does today: listing + contact ingestion (chatbot-engine),
 * the agenda command and event/to-do parsing (whatsapp-scheduler),
 * direct replies to lead alerts (reply-bridge), and the draft-session
 * commands. Keep it in step with those paths — a help card promising a
 * capability that no longer exists is worse than a generic one.
 */
export function buildOwnerHelpMessage(): string {
  const dash = dashboardUrl();
  const lines = [
    `🤖 *${BRANDING.name} on WhatsApp*`,
    '',
    "Send it here and I'll file it into your Engine — no app needed.",
    '',
    '*🏠 Add a listing*',
    'Paste the details, or forward an ad screenshot or brochure PDF. I pull out price, area, locality, type and amenities, then show you a draft to confirm.',
    '_e.g. "3750 sqft commercial site, Koramangala 3rd Block, 24.37 Cr, 60 ft road"_',
    '',
    '*👤 Add a contact or lead*',
    'Paste their profile, forward a portal lead (MagicBricks / Housing / 99acres), or send a screenshot. What they are looking for is saved as their requirement.',
    '_e.g. "Gaurav 98xxxxxx21 — wants plots 2400–4000 sqft in HSR or Koramangala"_',
    '',
    '*🗓 Calendar & to-dos*',
    '• *today* — your visits, calls and to-dos for the day',
    '• "Site visit with Varun tomorrow 4pm at JP Nagar" — books it',
    '• "Remind me to call Deepak on Friday" — adds a to-do',
    '• A voice note works too — say what, who and when',
    '',
    '*💬 Answer a lead*',
    'Reply to any lead alert I send you and your message goes straight to them.',
    '',
    '*✏️ While a draft is open*',
    '• Send photos or a video to attach them to the listing',
    '• Correct anything in plain language — "price is 1.8 Cr", "name is Suresh"',
    '• Tap *Confirm* to save, *Cancel* to discard',
    '• An untouched draft expires on its own after 1 hour',
  ];
  if (dash) {
    lines.push('', `Full dashboard: ${dash}`);
  }
  lines.push('', 'Send *help* any time to see this again.');
  return lines.join('\n');
}

/**
 * Reply to a message that reached the assistant but classified as
 * neither a listing nor a contact. Names the likely intents instead of
 * restating the whole menu.
 */
export function buildOwnerFallbackMessage(): string {
  return [
    "🤔 *I couldn't tell what that was.*",
    '',
    '• *A property?* Paste the listing details, or forward an ad screenshot or PDF.',
    '• *A lead?* Send their name, number and what they are looking for.',
    '• *Something to schedule?* Try "Site visit with Varun tomorrow 4pm" — or send *today* for your schedule.',
    '',
    'Send *help* to see everything I can do.',
  ].join('\n');
}
