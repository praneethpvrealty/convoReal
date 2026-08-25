// ============================================================
// Beta invite tokens — pure, server-side, no Supabase.
//
// Token handling is deliberately identical to team invites
// (src/lib/auth/invitations.ts): 32 bytes of CSPRNG, base64url,
// SHA-256 at rest, plaintext returned exactly once. Those two
// helpers are reused verbatim rather than reimplemented so the two
// invite systems can never drift on the part that matters.
//
// What is different here is the URL space and the human code.
// /join/<token> is taken by team invites, so beta invites live at
// /i/<token> — short enough to read out over a phone call.
// ============================================================

import { randomInt } from 'node:crypto';

import { generateInviteToken, hashInviteToken } from '@/lib/auth/invitations';

export { hashInviteToken };

/**
 * Alphabet for the speakable code. Excludes 0/O/1/I/L and vowels:
 * the code gets read down a phone line and typed back, so visually
 * confusable characters cost support time, and dropping vowels
 * means a random draw can't spell a word nobody wants to read out.
 */
const CODE_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 4;

export interface GeneratedBetaInvite {
  /** Plaintext token — goes in the link, never persisted. */
  token: string;
  /** SHA-256 hex of the token. This is what the DB stores. */
  hash: string;
  /** Speakable reference, e.g. "CONVO-7XKQ". Not a secret. */
  code: string;
}

/**
 * `randomInt` (not `Math.random`) because this string ends up in a
 * UNIQUE column — a weak generator raises the collision rate, and
 * a collision surfaces to a user as a failed invite.
 */
export function generateInviteCode(): string {
  let body = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return `CONVO-${body}`;
}

export function generateBetaInvite(): GeneratedBetaInvite {
  const { token, hash } = generateInviteToken();
  return { token, hash, code: generateInviteCode() };
}

/**
 * Build the shareable link. Tolerates a trailing slash on `baseUrl`
 * so callers can pass NEXT_PUBLIC_SITE_URL verbatim.
 */
export function betaInviteUrl(token: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/i/${token}`;
}

export function betaInviteWhatsAppUrl(
  message: string,
  inviteePhone?: string | null
): string {
  const phone = inviteePhone?.replace(/\D/g, '') ?? '';
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

/**
 * The WhatsApp share text, pre-filled behind the "Share on WhatsApp"
 * button in the invite hub.
 *
 * Sent personally by the inviter, never blasted by the platform: a
 * platform-sent MARKETING template needs Meta approval, interacts
 * with the 24-hour window rules, and reads like a campaign. One
 * broker forwarding a note to another broker is the entire social
 * proof of this programme.
 */
export function betaInviteShareMessage(args: {
  url: string;
  inviterName?: string | null;
  seatsRemaining?: number | null;
  expiryDays: number;
}): string {
  // Action-promise angle: one concrete promise ("see what matches by
  // tomorrow") and the exact first step, because the beta lives or
  // dies on activation, not signups. The inviter's name opens the
  // message — that's how a real broker text starts — and the URL is
  // always the last line so WhatsApp's link preview sits at the
  // bottom, next to the tap.
  const opener = args.inviterName
    ? `${args.inviterName} here — I've got a ConvoReal beta seat for you. They're letting in 100 property consultants this month, invite-only.`
    : "I've got a ConvoReal beta seat for you — they're letting in 100 property consultants this month, invite-only.";

  const scarcity =
    typeof args.seatsRemaining === 'number' && args.seatsRemaining > 0
      ? `Only ${args.seatsRemaining} of 100 seats left — your link dies in ${args.expiryDays} days:`
      : `Only 100 property consultants get in this month — your link dies in ${args.expiryDays} days:`;

  return [
    opener,
    '',
    'It runs my whole business on WhatsApp: every enquiry becomes a contact by itself, inventory matches itself to my buyers, and owners get updates without me typing a word.',
    '',
    'Your owners and buyers get their own free Portfolio too — they watch interest and matches themselves; every deal still runs through you.',
    '',
    "This is the AI era of real estate — the Engine is what turns a broker into a professional consultant. Don't get left behind.",
    '',
    `Claim the seat, import your buyer list, and see what matches by tomorrow. ${scarcity}`,
    args.url,
  ].join('\n');
}

/** Human label for a seat card. */
export function seatLabel(index: number): string {
  return `Seat ${index + 1}`;
}
