import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  CONSENT_OVERRIDE_WARNING,
  consentChangeNote,
  consentOverrideNeedsAck,
  isConsentState,
  type AlertsConsent,
} from '@/lib/contacts/alerts-consent';

// PATCH /api/contacts/[id]/consent — record what a client said about
// WhatsApp updates off-channel (on a call, at a site visit). Their own
// STOP/START ALERTS reply still writes the same column and remains the
// stronger record, which is why undoing a decline needs an explicit
// acknowledgement rather than a plain edit.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const limit = await checkRateLimit(
      `agent:contactConsent:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const next = body?.consent;
    if (!isConsentState(next)) {
      return NextResponse.json(
        { error: 'consent must be one of: pending, granted, declined' },
        { status: 400 }
      );
    }
    const reason = typeof body?.reason === 'string' ? body.reason : undefined;

    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id, buyer_alerts_consent')
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle();
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const previous: AlertsConsent = isConsentState(contact.buyer_alerts_consent)
      ? contact.buyer_alerts_consent
      : 'pending';

    if (previous === next) {
      return NextResponse.json({
        data: { consent: next, previous, changed: false },
      });
    }

    if (
      consentOverrideNeedsAck(previous, next) &&
      body?.acknowledgeOverride !== true
    ) {
      return NextResponse.json(
        {
          error: CONSENT_OVERRIDE_WARNING,
          code: 'CONSENT_OVERRIDE_REQUIRES_ACK',
        },
        { status: 409 }
      );
    }

    // Conditional on the value the override check was made against. A
    // contact can reply STOP ALERTS in the moment between that read and
    // this write; an unconditional update would overwrite their fresh
    // refusal with a decision taken before it, and skip the
    // acknowledgement that undoing a refusal is supposed to require.
    // Zero rows means the row moved under us, not that it is missing.
    const { data: updated, error } = await ctx.supabase
      .from('contacts')
      .update({ buyer_alerts_consent: next })
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .eq('buyer_alerts_consent', previous)
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        {
          error:
            'This contact’s consent changed while you were editing — most likely they replied on WhatsApp. Reopen the contact to see where it stands now.',
          code: 'CONSENT_CHANGED_CONCURRENTLY',
        },
        { status: 409 }
      );
    }

    // Consent is a compliance record, so every agent-side change leaves
    // a dated, attributed line on the contact. A failure here must not
    // lose the change itself.
    const { error: noteError } = await ctx.supabase
      .from('contact_notes')
      .insert({
        contact_id: id,
        account_id: ctx.accountId,
        user_id: ctx.userId,
        note_text: consentChangeNote(previous, next, reason),
      });
    if (noteError) {
      console.error(
        '[contact consent] change applied but the audit note failed:',
        noteError.message
      );
    }

    return NextResponse.json({
      data: { consent: next, previous, changed: true },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
