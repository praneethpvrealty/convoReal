'use client';

// ============================================================
// TeamsTab — Settings → Teams
//
// Org hierarchy (migration 082/083/084). Three things happen here:
//   1. Create/rename/delete teams.
//   2. Promote an Org Agent to Org Leader (or demote back) — Manager
//      only, via set_member_org_role.
//   3. Assign/remove a member's team via set_member_team.
//
// Role-gating mirrors members-tab.tsx: the tab is reachable by any
// member (read-only roster for Agents), mutation controls check
// `orgRole` from useAuth(), and the server-side RPCs double-check
// authority regardless of what the client shows.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Crown,
  Loader2,
  Plus,
  Shield,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import type { OrgRole } from '@/lib/auth/roles';
import type { AccountMember, Team } from '@/types';

const ROLE_CHIP: Record<OrgRole, { icon: typeof Crown; label: string; className: string }> = {
  org_manager: {
    icon: Crown,
    label: 'Manager',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  org_leader: {
    icon: Shield,
    label: 'Leader',
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  org_agent: {
    icon: UserCog,
    label: 'Agent',
    className: 'border-slate-700 bg-slate-800 text-slate-300',
  },
};

export function TeamsTab() {
  const { user, isOrgManager, isOrgLeader } = useAuth();
  const canManageTeams = isOrgManager || isOrgLeader;

  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [deletingTeam, setDeletingTeam] = useState<Team | null>(null);

  const loadEverything = useCallback(async () => {
    try {
      const [tres, mres] = await Promise.all([
        fetch('/api/account/teams', { cache: 'no-store' }),
        fetch('/api/account/members', { cache: 'no-store' }),
      ]);
      if (tres.ok) {
        const tdata = (await tres.json()) as { teams: Team[] };
        setTeams(tdata.teams);
      }
      if (mres.ok) {
        const mdata = (await mres.json()) as { members: AccountMember[] };
        setMembers(mdata.members);
      }
    } catch (err) {
      console.error('[TeamsTab] load error:', err);
      toast.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEverything();
  }, [loadEverything]);

  async function handleCreateTeam() {
    if (!newTeamName.trim()) return;
    setPending('create-team');
    try {
      const res = await fetch('/api/account/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTeamName.trim() }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to create team');
        return;
      }
      toast.success(`Created "${newTeamName.trim()}"`);
      setNewTeamName('');
      setCreateOpen(false);
      await loadEverything();
    } catch (err) {
      console.error('[TeamsTab] create team error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPending(null);
    }
  }

  async function handleDeleteTeam() {
    if (!deletingTeam) return;
    setPending(deletingTeam.id);
    try {
      const res = await fetch(`/api/account/teams/${deletingTeam.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to delete team');
        return;
      }
      toast.success(`Deleted "${deletingTeam.name}"`);
      setDeletingTeam(null);
      await loadEverything();
    } catch (err) {
      console.error('[TeamsTab] delete team error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPending(null);
    }
  }

  async function handleSetLeader(team: Team, leaderId: string | null) {
    setPending(`leader-${team.id}`);
    try {
      const res = await fetch(`/api/account/teams/${team.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaderId }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to update team leader');
        return;
      }
      await loadEverything();
    } catch (err) {
      console.error('[TeamsTab] set leader error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPending(null);
    }
  }

  async function handleSetMemberTeam(member: AccountMember, teamId: string | null) {
    setPending(`team-${member.user_id}`);
    try {
      const res = await fetch(`/api/account/members/${member.user_id}/team`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || "Failed to update member's team");
        return;
      }
      await loadEverything();
    } catch (err) {
      console.error('[TeamsTab] set member team error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPending(null);
    }
  }

  async function handlePromote(member: AccountMember, nextRole: 'org_leader' | 'org_agent') {
    setPending(`role-${member.user_id}`);
    try {
      const res = await fetch(`/api/account/members/${member.user_id}/org-role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to change role');
        return;
      }
      toast.success(
        `${member.full_name || 'Member'} is now ${nextRole === 'org_leader' ? 'a Leader' : 'an Agent'}`,
      );
      await loadEverything();
    } catch (err) {
      console.error('[TeamsTab] promote error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPending(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const unassigned = members.filter(
    (m) => m.org_role && m.org_role !== 'org_manager' && !m.team_id,
  );
  // Leaders/Agents eligible to be dropped into a team via the picker —
  // anyone who isn't already Manager (Managers see everything account-
  // wide and never need a team).
  const assignableMembers = members.filter((m) => m.org_role && m.org_role !== 'org_manager');

  return (
    <div className="space-y-6 mt-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Teams</h2>
          <p className="text-sm text-slate-400">
            Group agents under a Leader. Leaders only see their own team&apos;s conversations
            and contacts — Managers see everything.
          </p>
        </div>
        {canManageTeams && (
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            New team
          </Button>
        )}
      </div>

      {teams.length === 0 ? (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <Users className="size-6 text-slate-600" />
            <p className="mt-2 text-sm text-slate-400">No teams yet.</p>
            {canManageTeams && (
              <p className="mt-1 text-xs text-slate-500">
                Create one above to start routing conversations by team.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {teams.map((team) => {
            const teamMembers = members.filter((m) => m.team_id === team.id);
            const leader = members.find((m) => m.user_id === team.leader_id);
            const canEditThisTeam = isOrgManager || (isOrgLeader && team.leader_id === user?.id);

            return (
              <Card key={team.id} className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">{team.name}</h3>
                      <p className="text-xs text-slate-500">
                        Leader: {leader?.full_name || 'Unassigned'} · {teamMembers.length} member
                        {teamMembers.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    {isOrgManager && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeletingTeam(team)}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>

                  {isOrgManager && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 shrink-0">Set leader:</span>
                      <Select
                        value={team.leader_id ?? '__none__'}
                        onValueChange={(v) => handleSetLeader(team, v === '__none__' ? null : v)}
                      >
                        <SelectTrigger
                          className="w-48 bg-slate-800 border-slate-700 text-slate-200"
                          disabled={pending === `leader-${team.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Unassigned</SelectItem>
                          {members
                            .filter((m) => m.org_role === 'org_leader')
                            .map((m) => (
                              <SelectItem key={m.user_id} value={m.user_id}>
                                {m.full_name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
                    {teamMembers.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-slate-500">No members yet.</li>
                    ) : (
                      teamMembers.map((m) => {
                        const roleMeta = m.org_role ? ROLE_CHIP[m.org_role] : ROLE_CHIP.org_agent;
                        const RoleIcon = roleMeta.icon;
                        return (
                          <li
                            key={m.user_id}
                            className="flex items-center justify-between gap-2 px-3 py-2"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Avatar className="size-6 shrink-0">
                                <AvatarFallback className="bg-primary/10 text-[10px] font-medium text-primary">
                                  {(m.full_name || 'U').charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate text-sm text-white">{m.full_name}</span>
                              <span
                                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${roleMeta.className}`}
                              >
                                <RoleIcon className="size-3" />
                                {roleMeta.label}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isOrgManager && m.org_role === 'org_agent' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handlePromote(m, 'org_leader')}
                                  disabled={pending === `role-${m.user_id}`}
                                  className="h-7 border-slate-700 text-slate-300 hover:bg-slate-800"
                                >
                                  Promote to Leader
                                </Button>
                              )}
                              {isOrgManager && m.org_role === 'org_leader' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handlePromote(m, 'org_agent')}
                                  disabled={pending === `role-${m.user_id}`}
                                  className="h-7 border-slate-700 text-slate-300 hover:bg-slate-800"
                                >
                                  Demote to Agent
                                </Button>
                              )}
                              {canEditThisTeam && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleSetMemberTeam(m, null)}
                                  disabled={pending === `team-${m.user_id}`}
                                  className="h-7 border-slate-700 text-slate-400 hover:bg-slate-800"
                                >
                                  Remove
                                </Button>
                              )}
                            </div>
                          </li>
                        );
                      })
                    )}
                  </ul>

                  {canEditThisTeam && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 shrink-0">Add member:</span>
                      <Select
                        value=""
                        onValueChange={(v) => {
                          const m = assignableMembers.find((x) => x.user_id === v);
                          if (m) handleSetMemberTeam(m, team.id);
                        }}
                      >
                        <SelectTrigger className="w-48 bg-slate-800 border-slate-700 text-slate-200">
                          <SelectValue placeholder="Choose a member..." />
                        </SelectTrigger>
                        <SelectContent>
                          {assignableMembers
                            .filter((m) => m.team_id !== team.id && (isOrgManager || m.org_role === 'org_agent'))
                            .map((m) => (
                              <SelectItem key={m.user_id} value={m.user_id}>
                                {m.full_name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {unassigned.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-white">Unassigned members</h3>
          <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
            <CardContent className="p-0">
              <ul className="divide-y divide-slate-800">
                {unassigned.map((m) => (
                  <li key={m.user_id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className="text-sm text-white">{m.full_name}</span>
                    {teams.length > 0 && (isOrgManager || isOrgLeader) && (
                      <Select
                        value=""
                        onValueChange={(v) => handleSetMemberTeam(m, v)}
                      >
                        <SelectTrigger className="w-44 bg-slate-800 border-slate-700 text-slate-200 h-8">
                          <SelectValue placeholder="Assign to team..." />
                        </SelectTrigger>
                        <SelectContent>
                          {teams
                            .filter((t) => isOrgManager || t.leader_id === user?.id)
                            .map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">New team</DialogTitle>
            <DialogDescription className="text-slate-400">
              Give it a name — you can assign a leader and members after creating it.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="e.g. North Bangalore Team"
            className="bg-slate-800 border-slate-700 text-white"
          />
          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateTeam}
              disabled={!newTeamName.trim() || pending === 'create-team'}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {pending === 'create-team' ? <Loader2 className="size-4 animate-spin" /> : 'Create team'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletingTeam !== null} onOpenChange={(open) => { if (!open) setDeletingTeam(null); }}>
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Delete team</DialogTitle>
            <DialogDescription className="text-slate-400">
              Delete <span className="font-medium text-slate-300">{deletingTeam?.name}</span>?
              Its members become unassigned; their conversations and contacts stay exactly
              as-is, just no longer scoped to this team.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setDeletingTeam(null)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteTeam}
              disabled={pending === deletingTeam?.id}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {pending === deletingTeam?.id ? <Loader2 className="size-4 animate-spin" /> : 'Delete team'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
