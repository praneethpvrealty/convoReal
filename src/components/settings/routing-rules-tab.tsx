'use client';

// ============================================================
// RoutingRulesTab — Settings → Routing Rules
//
// Org Manager only (matches the design doc: routing configuration
// is a Manager capability, not delegated to Leaders). Simple rule
// list — type, match value, target team/agent, priority, active
// toggle — CRUD against routing_rules. The actual matching logic
// lives in src/lib/whatsapp/routing-engine.ts.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Route, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import type { AccountMember, RoutingRule, RoutingRuleType, Team } from '@/types';

const RULE_TYPE_LABELS: Record<RoutingRuleType, string> = {
  locality_match: 'Locality match',
  source_match: 'Lead source match',
  keyword_match: 'Keyword match',
  round_robin: 'Round robin (within a team)',
  fallback: 'Fallback / unassigned queue',
};

const RULE_TYPE_OPTIONS: RoutingRuleType[] = [
  'locality_match',
  'source_match',
  'keyword_match',
  'fallback',
];

export function RoutingRulesTab() {
  const { isOrgManager } = useAuth();

  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);

  const [newRuleType, setNewRuleType] = useState<RoutingRuleType>('locality_match');
  const [newMatchValue, setNewMatchValue] = useState('');
  const [newTargetType, setNewTargetType] = useState<'team' | 'agent'>('team');
  const [newTargetId, setNewTargetId] = useState('');

  const loadEverything = useCallback(async () => {
    try {
      const [rres, tres, mres] = await Promise.all([
        fetch('/api/account/routing-rules', { cache: 'no-store' }),
        fetch('/api/account/teams', { cache: 'no-store' }),
        fetch('/api/account/members', { cache: 'no-store' }),
      ]);
      if (rres.ok) setRules(((await rres.json()) as { rules: RoutingRule[] }).rules);
      if (tres.ok) setTeams(((await tres.json()) as { teams: Team[] }).teams);
      if (mres.ok) setMembers(((await mres.json()) as { members: AccountMember[] }).members);
    } catch (err) {
      console.error('[RoutingRulesTab] load error:', err);
      toast.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEverything();
  }, [loadEverything]);

  async function handleCreate() {
    if (!newTargetId) {
      toast.error('Pick a target team or agent first');
      return;
    }
    if (newRuleType !== 'fallback' && !newMatchValue.trim()) {
      toast.error('Match value is required for this rule type');
      return;
    }
    setPending('create');
    try {
      const res = await fetch('/api/account/routing-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleType: newRuleType,
          matchValue: newRuleType === 'fallback' ? null : newMatchValue.trim(),
          targetTeamId: newTargetType === 'team' ? newTargetId : null,
          targetAgentId: newTargetType === 'agent' ? newTargetId : null,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to create rule');
        return;
      }
      toast.success('Routing rule created');
      setNewMatchValue('');
      setNewTargetId('');
      await loadEverything();
    } catch (err) {
      console.error('[RoutingRulesTab] create error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPending(null);
    }
  }

  async function handleToggleActive(rule: RoutingRule) {
    setPending(rule.id);
    try {
      const res = await fetch(`/api/account/routing-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !rule.is_active }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to update rule');
        return;
      }
      await loadEverything();
    } catch (err) {
      console.error('[RoutingRulesTab] toggle error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPending(null);
    }
  }

  async function handleDelete(rule: RoutingRule) {
    setPending(rule.id);
    try {
      const res = await fetch(`/api/account/routing-rules/${rule.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to delete rule');
        return;
      }
      toast.success('Routing rule deleted');
      await loadEverything();
    } catch (err) {
      console.error('[RoutingRulesTab] delete error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPending(null);
    }
  }

  function targetLabel(rule: RoutingRule): string {
    if (rule.target_team_id) {
      return teams.find((t) => t.id === rule.target_team_id)?.name ?? 'Unknown team';
    }
    if (rule.target_agent_id) {
      return members.find((m) => m.user_id === rule.target_agent_id)?.full_name ?? 'Unknown agent';
    }
    return '—';
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isOrgManager) {
    return (
      <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent mt-4">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <Route className="size-6 text-slate-600" />
          <p className="mt-2 text-sm text-slate-400">
            Only the Org Manager can view and edit routing rules.
          </p>
        </CardContent>
      </Card>
    );
  }

  const targetOptions = newTargetType === 'team' ? teams : members.filter((m) => m.org_role === 'org_agent');

  return (
    <div className="space-y-6 mt-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Routing rules</h2>
        <p className="text-sm text-slate-400">
          Inbound WhatsApp conversations are auto-assigned by priority: an existing
          conversation stays with its agent, then an explicit contact assignment, then
          these rules (locality, then lead source), then round-robin within the fallback
          team, then the unassigned queue.
        </p>
      </div>

      <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
        <CardContent className="p-0">
          {rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Route className="size-6 text-slate-600" />
              <p className="mt-2 text-sm text-slate-400">No routing rules yet.</p>
              <p className="mt-1 text-xs text-slate-500">
                Unmatched conversations land in the unassigned queue for a Leader to triage.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {rules.map((rule) => (
                <li key={rule.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">
                        {RULE_TYPE_LABELS[rule.rule_type]}
                      </span>
                      <Badge className="bg-slate-800 text-slate-400 border-slate-700 text-[10px]">
                        priority {rule.priority}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {rule.match_value ? `"${rule.match_value}" → ` : ''}
                      {targetLabel(rule)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Switch
                      checked={rule.is_active}
                      onCheckedChange={() => handleToggleActive(rule)}
                      disabled={pending === rule.id}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(rule)}
                      disabled={pending === rule.id}
                      className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">New rule</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select value={newRuleType} onValueChange={(v) => setNewRuleType(v as RoutingRuleType)}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RULE_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {RULE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {newRuleType !== 'fallback' && (
              <Input
                value={newMatchValue}
                onChange={(e) => setNewMatchValue(e.target.value)}
                placeholder={
                  newRuleType === 'locality_match'
                    ? 'e.g. Whitefield'
                    : newRuleType === 'source_match'
                      ? 'e.g. MagicBricks'
                      : 'keyword'
                }
                className="bg-slate-800 border-slate-700 text-white"
              />
            )}

            <Select value={newTargetType} onValueChange={(v) => { setNewTargetType(v as 'team' | 'agent'); setNewTargetId(''); }}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="team">Route to a team</SelectItem>
                <SelectItem value="agent">Route to a specific agent</SelectItem>
              </SelectContent>
            </Select>

            <Select value={newTargetId} onValueChange={(v) => setNewTargetId(v ?? '')}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200">
                <SelectValue placeholder={newTargetType === 'team' ? 'Choose a team...' : 'Choose an agent...'} />
              </SelectTrigger>
              <SelectContent>
                {targetOptions.map((opt) => (
                  <SelectItem
                    key={'id' in opt ? opt.id : opt.user_id}
                    value={'id' in opt ? opt.id : opt.user_id}
                  >
                    {'name' in opt ? opt.name : opt.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={handleCreate}
            disabled={pending === 'create'}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {pending === 'create' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add rule
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
