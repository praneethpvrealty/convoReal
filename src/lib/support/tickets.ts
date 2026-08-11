// ============================================================
// Support ticket helpers — pure, no Supabase.
//
// Tickets are the helper chat's escalation path: when the copilot
// can't answer (or only partly can), the user hands the question to
// the ConvoReal support team and picks how the reply should reach
// them — WhatsApp or email. The reference works like BUG-XXXX does
// for bug reports: something a user can quote on a call.
// ============================================================

import { randomInt } from 'node:crypto';

/** Same speakable alphabet as invite codes and bug references. */
const REF_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ';
const REF_LENGTH = 4;

export const TICKET_STATUSES = [
  'open',
  'assigned',
  'answered',
  'closed',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_CHANNELS = ['whatsapp', 'email'] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];

export function isTicketStatus(value: unknown): value is TicketStatus {
  return (
    typeof value === 'string' &&
    (TICKET_STATUSES as readonly string[]).includes(value)
  );
}

export function isTicketChannel(value: unknown): value is TicketChannel {
  return (
    typeof value === 'string' &&
    (TICKET_CHANNELS as readonly string[]).includes(value)
  );
}

export function generateTicketReference(): string {
  let body = '';
  for (let i = 0; i < REF_LENGTH; i++) {
    body += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  }
  return `HELP-${body}`;
}

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  assigned: 'Assigned',
  answered: 'Answered',
  closed: 'Closed',
};

/** WhatsApp reply sent from the platform number. Kept as one builder
 *  so the free-form fallback and any future template share wording. */
export function buildTicketReplyText(
  reference: string,
  answer: string
): string {
  return `*ConvoReal Support* (${reference})\n\n${answer}\n\nReply to this message if you need more help.`;
}

export function buildTicketReplyEmail(params: {
  reference: string;
  question: string;
  answer: string;
}): { subject: string; html: string; text: string } {
  const { reference, question, answer } = params;
  const subject = `[${reference}] Your ConvoReal support request`;
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h2 style="color: #7c3aed; margin-bottom: 16px;">ConvoReal Support</h2>
      <p style="color: #6b7280; font-size: 13px;">Ticket ${esc(reference)}</p>
      <div style="background: #f3f4f6; border-radius: 8px; padding: 12px 16px; margin: 12px 0; font-size: 14px;">
        <strong>You asked:</strong><br/>${esc(question)}
      </div>
      <p style="font-size: 15px; line-height: 1.6;">${esc(answer)}</p>
      <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">Reply to this email if you need more help.</p>
    </div>`;
  const text = `ConvoReal Support (${reference})\n\nYou asked: ${question}\n\n${answer}\n\nReply to this email if you need more help.`;
  return { subject, html, text };
}
