import { NextResponse } from 'next/server';
import { requireOrgRole, toErrorResponse } from '@/lib/auth/account';
import {
  readCopilotActionExecutionRequest,
  type CopilotActionExecutionResult,
} from '@/lib/copilot/actions';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

interface RpcResult {
  action_id?: unknown;
  entity_id?: unknown;
  status?: unknown;
  outcome?: unknown;
  replayed?: unknown;
  executed_at?: unknown;
}

function normalizeResult(raw: unknown): CopilotActionExecutionResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const result = raw as RpcResult;
  if (
    typeof result.action_id !== 'string' ||
    typeof result.entity_id !== 'string' ||
    result.status !== 'completed' ||
    (result.outcome !== 'applied' && result.outcome !== 'already_completed') ||
    typeof result.replayed !== 'boolean' ||
    typeof result.executed_at !== 'string'
  ) {
    return null;
  }
  return {
    actionId: result.action_id,
    type: 'complete_event',
    entityId: result.entity_id,
    status: result.status,
    outcome: result.outcome,
    replayed: result.replayed,
    executedAt: result.executed_at,
  };
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrgRole('org_agent');
    const limit = await checkRateLimit(
      `copilot:action:${ctx.userId}`,
      RATE_LIMITS.copilotAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const parsed = readCopilotActionExecutionRequest(
      await request.json().catch(() => null)
    );
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data, error } = await ctx.supabase.rpc(
      'complete_copilot_appointment',
      {
        p_appointment_id: parsed.entityId,
        p_idempotency_key: parsed.actionId,
        p_platform: parsed.platform,
      }
    );
    if (error) {
      if (error.code === 'P0002') {
        return NextResponse.json(
          { error: 'Calendar event not found' },
          { status: 404 }
        );
      }
      if (
        error.message === 'Cancelled calendar events cannot be completed' ||
        error.message === 'Idempotency key was already used for another action'
      ) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      console.error('[copilot/actions] RPC failed:', error.code);
      return NextResponse.json(
        { error: 'Could not complete the calendar event' },
        { status: 500 }
      );
    }

    const result = normalizeResult(data);
    if (
      !result ||
      result.actionId !== parsed.actionId ||
      result.entityId !== parsed.entityId
    ) {
      return NextResponse.json(
        { error: 'Could not verify the calendar update' },
        { status: 500 }
      );
    }
    return NextResponse.json({ data: result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
