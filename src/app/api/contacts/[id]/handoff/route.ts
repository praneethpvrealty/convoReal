import { NextRequest, NextResponse } from 'next/server';
import type { PostgrestError } from '@supabase/supabase-js';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

// POST /api/contacts/[id]/handoff — reassign a contact to a different agent.
//
// Any agent+ role can attempt this; the SECURITY DEFINER RPC
// (migration 083) enforces exactly who's allowed to hand off what:
//   - Org Manager: any contact, to any agent in the account.
//   - Org Leader: only within their own team (both the contact's
//     current team and the target agent's team must match theirs).
//   - Org Agent: only a contact currently assigned to themselves,
//     to a teammate in their own team.
// This route only forwards the call and maps Postgres SQLSTATEs to
// HTTP statuses — the RPC does the real authorization work.

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === '42501') {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === '22023') {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error('[handoff route] unexpected RPC error:', err);
  return NextResponse.json({ error: 'Failed to hand off contact' }, { status: 500 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const limit = checkRateLimit(
      `agent:handoffContact:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { newAgentId?: unknown }
      | null;
    const newAgentId = body?.newAgentId;

    if (typeof newAgentId !== 'string' || newAgentId.trim().length === 0) {
      return NextResponse.json(
        { error: "'newAgentId' is required" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc('handoff_contact', {
      p_contact_id: contactId,
      p_new_agent_id: newAgentId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
