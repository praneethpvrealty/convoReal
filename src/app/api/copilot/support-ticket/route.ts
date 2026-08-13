// ============================================================
// /api/copilot/support-ticket
//
//   GET  — this account's own tickets (any member).
//   POST — file one from the helper chat.
//
// The escalation path behind the chat's "Ask the support team"
// button: the question, the helper's last reply and the coverage
// verdict travel with the ticket so triage starts with context, and
// the user picks how the answer should come back — WhatsApp or
// email. Answers are sent from Admin → Support (service-role route).
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { logCopilotEvent } from '@/lib/copilot/events';
import { parseCoverage, parsePlatform } from '@/lib/copilot/platform';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  generateTicketReference,
  isTicketChannel,
} from '@/lib/support/tickets';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';

const MAX_QUESTION_LEN = 1_000;
const MAX_REPLY_LEN = 2_000;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('support_tickets')
      .select(
        'id, reference, question, status, preferred_channel, answer, answered_at, created_at'
      )
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[GET /api/copilot/support-ticket] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load support tickets' },
        { status: 500 }
      );
    }

    return NextResponse.json({ tickets: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const limit = await checkRateLimit(
      `support-ticket:${ctx.userId}`,
      RATE_LIMITS.supportTicket
    );
    if (!limit.success) return rateLimitResponse(limit);

    let payload: {
      question?: unknown;
      helper_reply?: unknown;
      coverage?: unknown;
      platform?: unknown;
      pathname?: unknown;
      channel?: unknown;
      destination?: unknown;
    };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const question =
      typeof payload.question === 'string'
        ? payload.question.trim().slice(0, MAX_QUESTION_LEN)
        : '';
    if (!question) {
      return NextResponse.json(
        { error: 'Tell us what you need help with' },
        { status: 400 }
      );
    }

    const channel = isTicketChannel(payload.channel)
      ? payload.channel
      : 'whatsapp';
    const rawDestination =
      typeof payload.destination === 'string' ? payload.destination.trim() : '';

    let contactPhone: string | null = null;
    let contactEmail: string | null = null;
    if (channel === 'whatsapp') {
      contactPhone = normalizePhoneWithCountryCode(rawDestination);
      if (!contactPhone) {
        return NextResponse.json(
          { error: 'Share the WhatsApp number we should reply to' },
          { status: 400 }
        );
      }
    } else {
      if (!EMAIL_RE.test(rawDestination)) {
        return NextResponse.json(
          { error: 'Share the email address we should reply to' },
          { status: 400 }
        );
      }
      contactEmail = rawDestination.slice(0, 200);
    }

    const { data, error } = await ctx.supabase
      .from('support_tickets')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        reference: generateTicketReference(),
        question,
        helper_reply:
          typeof payload.helper_reply === 'string'
            ? payload.helper_reply.slice(0, MAX_REPLY_LEN)
            : null,
        coverage: parseCoverage(payload.coverage),
        platform: parsePlatform(payload.platform),
        pathname:
          typeof payload.pathname === 'string'
            ? payload.pathname.slice(0, 100)
            : null,
        preferred_channel: channel,
        contact_phone: contactPhone,
        contact_email: contactEmail,
      })
      .select('id, reference')
      .single();

    if (error) {
      console.error('[POST /api/copilot/support-ticket] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to send your request' },
        { status: 500 }
      );
    }

    logCopilotEvent({
      accountId: ctx.accountId,
      userId: ctx.userId,
      platform: parsePlatform(payload.platform),
      event: 'support_ticket',
      coverage: parseCoverage(payload.coverage),
    });

    return NextResponse.json({ id: data.id, reference: data.reference });
  } catch (err) {
    return toErrorResponse(err);
  }
}
