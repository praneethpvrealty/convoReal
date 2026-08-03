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

import { randomInt } from "node:crypto";

import { generateInviteToken, hashInviteToken } from "@/lib/auth/invitations";

export { hashInviteToken };

/**
 * Alphabet for the speakable code. Excludes 0/O/1/I/L and vowels:
 * the code gets read down a phone line and typed back, so visually
 * confusable characters cost support time, and dropping vowels
 * means a random draw can't spell a word nobody wants to read out.
 */
const CODE_ALPHABET = "23456789BCDFGHJKMNPQRSTVWXYZ";
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
  let body = "";
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
  return `${baseUrl.replace(/\/+$/, "")}/i/${token}`;
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
  const lines = [
    "Hey — I'm on the ConvoReal beta and I've got a seat for you.",
    "",
    "It's a WhatsApp-first deal engine built for how we actually work: enquiries land as chats, inventory and matching in one place, no more Excel + 6 portals.",
    "",
    typeof args.seatsRemaining === "number" && args.seatsRemaining > 0
      ? `Only ${args.seatsRemaining} of 100 seats left this month. Your link (expires in ${args.expiryDays} days):`
      : `Only 100 brokerages get in this month. Your link (expires in ${args.expiryDays} days):`,
    args.url,
  ];

  if (args.inviterName) {
    lines.push("", `— ${args.inviterName}`);
  }

  return lines.join("\n");
}

/** Human label for a seat card. */
export function seatLabel(index: number): string {
  return `Seat ${index + 1}`;
}
