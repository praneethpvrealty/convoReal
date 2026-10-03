import {
  hasRecentAgentReply,
  standDownActiveFlowRuns,
} from '@/lib/whatsapp/agent-takeover';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export async function agentHandling(
  ctx: InboundChainContext
): Promise<StepResult> {
  const { accountId, contactRecord, conversation } = ctx;
  // A human agent already talking to this lead owns the conversation:
  // suppress flow ENTRY so a stray keyword cannot restart the welcome
  // funnel underneath them. Active runs still advance — the lead is
  // mid-answer and expects the next question.
  const agentHandling = await hasRecentAgentReply(
    supabaseAdmin(),
    conversation.id
  );
  if (agentHandling) {
    // A run that outlived the send-time pause would keep answering the
    // lead "Sorry, I didn't quite catch that" through a live
    // negotiation. Stand it down before dispatch, so this message
    // reaches the agent instead of the funnel.
    const stoodDown = await standDownActiveFlowRuns(
      supabaseAdmin(),
      accountId,
      contactRecord.id
    );
    if (stoodDown > 0) {
      console.log(
        `[webhook] Stood down ${stoodDown} flow run(s) — an agent is handling this thread`
      );
    }
  }
  ctx.agentHandling = agentHandling;
  return 'continue';
}
