// ============================================================
// WhatsApp conversation routing engine.
//
// Called once per inbound message, from webhook-handler.ts's
// processMessage(), right after the message body has been parsed
// (needed for the locality rule) and before it's persisted. Decides
// which agent/team a NEW conversation should land with — already
// assigned conversations are never re-routed (checked by the
// caller before invoking this).
//
// 6-rule priority chain, first match wins — mirrors
// ConvoReal-Engineering-OS/ORG_HIERARCHY_DESIGN.md §4 exactly:
//   1. Existing conversation continuity (handled by the caller: if
//      the conversation already has an assignment, resolveRouting
//      is never called at all — see webhook-handler.ts).
//   2. Contact has an explicit assigned_agent_id -> route there.
//   3. Locality/area match: routing_rules (locality_match) +
//      profiles.coverage_areas against the inbound message text.
//   4. Lead source match: routing_rules (source_match) against
//      contact.source.
//   5. Round-robin within the fallback team: least-loaded
//      available agent (fewest open conversations).
//   6. No match -> team leader's unassigned queue (requiresManualAssignment).
//
// Solo Mode: the caller skips calling this entirely when the
// account has fewer than 2 members — see the Solo Mode check in
// webhook-handler.ts, not duplicated here, so this module has no
// account-shape special-casing of its own.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _adminClient: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

export interface RoutingContext {
  accountId: string;
  phone: string;
  messageText: string;
  contactId: string;
  /** contacts.assigned_agent_id, if already set explicitly. */
  contactAssignedAgentId?: string | null;
  /** contacts.source — 'WhatsApp' | 'MagicBricks' | 'Housing.com' | '99acres' | 'Manual' | etc. */
  source?: string | null;
}

export type RoutingRuleUsed =
  | 'explicit'
  | 'locality'
  | 'source'
  | 'round_robin'
  | 'leader_queue';

export interface RoutingResult {
  agentId: string | null;
  teamId: string | null;
  ruleUsed: RoutingRuleUsed;
  requiresManualAssignment: boolean;
}

interface RoutingRuleRow {
  id: string;
  rule_type: 'locality_match' | 'source_match' | 'keyword_match' | 'round_robin' | 'fallback';
  match_value: string | null;
  target_team_id: string | null;
  target_agent_id: string | null;
  priority: number;
}

/** Unassigned result — lands in the leader/manager queue for manual triage. */
const UNASSIGNED_QUEUE: RoutingResult = {
  agentId: null,
  teamId: null,
  ruleUsed: 'leader_queue',
  requiresManualAssignment: true,
};

/**
 * Verifies a candidate agent/team still belongs to this account before
 * trusting a routing_rules row — guards against a stale rule pointing at
 * a removed member or deleted team.
 */
async function resolveTeamForAgent(
  db: SupabaseClient,
  accountId: string,
  agentId: string,
): Promise<{ valid: boolean; teamId: string | null }> {
  const { data } = await db
    .from('profiles')
    .select('account_id, team_id')
    .eq('user_id', agentId)
    .maybeSingle();
  if (!data || data.account_id !== accountId) return { valid: false, teamId: null };
  return { valid: true, teamId: (data.team_id as string | null) ?? null };
}

export async function resolveRouting(ctx: RoutingContext): Promise<RoutingResult> {
  const db = supabaseAdmin();

  // Rule 2: contact already has an explicit assignment.
  if (ctx.contactAssignedAgentId) {
    const { valid, teamId } = await resolveTeamForAgent(db, ctx.accountId, ctx.contactAssignedAgentId);
    if (valid) {
      return { agentId: ctx.contactAssignedAgentId, teamId, ruleUsed: 'explicit', requiresManualAssignment: false };
    }
  }

  const { data: rules } = await db
    .from('routing_rules')
    .select('id, rule_type, match_value, target_team_id, target_agent_id, priority')
    .eq('account_id', ctx.accountId)
    .eq('is_active', true)
    .order('priority', { ascending: true });
  const activeRules = (rules ?? []) as RoutingRuleRow[];

  // Rule 3: locality/area match — inbound message text against
  // routing_rules(locality_match).match_value, then against
  // profiles.coverage_areas for any agent in the account.
  const lowerText = (ctx.messageText || '').toLowerCase();
  if (lowerText) {
    const localityRules = activeRules.filter((r) => r.rule_type === 'locality_match' && r.match_value);
    for (const rule of localityRules) {
      const keyword = rule.match_value!.toLowerCase().trim();
      if (!keyword || !lowerText.includes(keyword)) continue;
      if (rule.target_agent_id) {
        const { valid, teamId } = await resolveTeamForAgent(db, ctx.accountId, rule.target_agent_id);
        if (valid) {
          return { agentId: rule.target_agent_id, teamId, ruleUsed: 'locality', requiresManualAssignment: false };
        }
      } else if (rule.target_team_id) {
        return { agentId: null, teamId: rule.target_team_id, ruleUsed: 'locality', requiresManualAssignment: false };
      }
    }

    // Fall back to matching directly against each agent's own
    // coverage_areas when no routing_rules row covers this keyword.
    const { data: coveredAgents } = await db
      .from('profiles')
      .select('user_id, team_id, coverage_areas')
      .eq('account_id', ctx.accountId)
      .not('coverage_areas', 'is', null);
    for (const agent of coveredAgents ?? []) {
      const areas = (agent.coverage_areas as string[] | null) ?? [];
      const hit = areas.some((a) => a.trim() && lowerText.includes(a.toLowerCase().trim()));
      if (hit) {
        return {
          agentId: agent.user_id as string,
          teamId: (agent.team_id as string | null) ?? null,
          ruleUsed: 'locality',
          requiresManualAssignment: false,
        };
      }
    }
  }

  // Rule 4: lead source match.
  if (ctx.source) {
    const sourceRule = activeRules.find(
      (r) => r.rule_type === 'source_match' && r.match_value?.toLowerCase() === ctx.source!.toLowerCase(),
    );
    if (sourceRule) {
      if (sourceRule.target_agent_id) {
        const { valid, teamId } = await resolveTeamForAgent(db, ctx.accountId, sourceRule.target_agent_id);
        if (valid) {
          return { agentId: sourceRule.target_agent_id, teamId, ruleUsed: 'source', requiresManualAssignment: false };
        }
      } else if (sourceRule.target_team_id) {
        return { agentId: null, teamId: sourceRule.target_team_id, ruleUsed: 'source', requiresManualAssignment: false };
      }
    }
  }

  // Rule 5: round-robin within the fallback team — least-loaded
  // available agent (fewest currently-open conversations).
  const fallbackRule = activeRules.find((r) => r.rule_type === 'fallback' && r.target_team_id);
  if (fallbackRule?.target_team_id) {
    const { data: teamAgents } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', ctx.accountId)
      .eq('team_id', fallbackRule.target_team_id)
      .eq('org_role', 'org_agent')
      .eq('is_available', true);

    if (teamAgents && teamAgents.length > 0) {
      const loads = await Promise.all(
        teamAgents.map(async (a) => {
          const { count } = await db
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('assigned_agent_id', a.user_id)
            .eq('status', 'open');
          return { agentId: a.user_id as string, load: count ?? 0 };
        }),
      );
      loads.sort((a, b) => a.load - b.load);
      return {
        agentId: loads[0].agentId,
        teamId: fallbackRule.target_team_id,
        ruleUsed: 'round_robin',
        requiresManualAssignment: false,
      };
    }
    // Team has no available agents — fall through to the queue,
    // scoped to that team so its leader sees it.
    return { agentId: null, teamId: fallbackRule.target_team_id, ruleUsed: 'leader_queue', requiresManualAssignment: true };
  }

  // Rule 6: nothing matched — unassigned leader/manager queue.
  return UNASSIGNED_QUEUE;
}
