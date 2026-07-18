import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';

// POST /api/liaison-workflows/[id]/share — send the process explanation
// to a contact on WhatsApp. The dispatcher finds or creates the
// conversation, so this works for contacts you've never chatted with
// (subject to Meta's 24h free-form window on the receiving side).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: workflowId } = await params;

    // A WhatsApp send, not an admin action — share the send budget.
    const limit = checkRateLimit(`send:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { contact_id, message } = body;

    // Validation
    if (typeof contact_id !== 'string' || contact_id.length === 0) {
      return NextResponse.json({ error: "'contact_id' is required" }, { status: 400 });
    }
    if (typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: "'message' is required" }, { status: 400 });
    }

    // Resolve both ends through the RLS-scoped client — the workflow to
    // prove it's this tenant's, the contact for the send target.
    const { data: workflow } = await ctx.supabase
      .from('liaison_workflows')
      .select('id')
      .eq('id', workflowId)
      .maybeSingle();
    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id, phone')
      .eq('id', contact_id)
      .maybeSingle();
    if (!contact?.phone) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const result = await sendWhatsAppMessageAndPersist({
      accountId: ctx.accountId,
      userId: ctx.userId,
      contactId: contact.id,
      kind: 'text',
      // The client edits the preview before sending — trust their text,
      // not a re-render of the workflow.
      text: message.trim(),
      senderType: 'agent',
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send on WhatsApp' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, message_id: result.messageId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
