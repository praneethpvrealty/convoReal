'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';

interface ActiveUser {
  id: string;
  name: string;
  /** Only set for client-sourced entries — team members (profiles) have no name_tag. */
  nameTag?: string | null;
  group: 'team' | 'client';
  role: string;
  status: 'Online' | 'Away' | 'Offline';
  action: string;
  avatar: string;
}

const STATIC_FALLBACK_USERS: ActiveUser[] = [
  {
    id: '1',
    name: 'Mia L.',
    group: 'team',
    role: 'Manager',
    status: 'Online',
    action: 'Closed ₹15.8L Deal',
    avatar: 'ML',
  },
  {
    id: '2',
    name: 'Ryan P.',
    group: 'team',
    role: 'Agent',
    status: 'Online',
    action: 'Updated Pipeline',
    avatar: 'RP',
  },
  {
    id: '3',
    name: 'David K.',
    group: 'client',
    role: 'Client',
    status: 'Online',
    action: 'Joined WhatsApp Chat',
    avatar: 'DK',
  },
];

const USER_GROUPS = [
  { group: 'team', label: 'Team' },
  { group: 'client', label: 'Clients' },
] as const;

export function ActiveUsers() {
  const supabase = createClient();
  const { user: currentUser, accountId } = useAuth();
  const [users, setUsers] = useState<ActiveUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadActiveUsers() {
      try {
        // 1. Fetch team members (profiles) in the current account.
        //    user_id (the auth uid) is needed to exclude the viewer —
        //    profiles.id is the profile row's own uuid and never
        //    matches currentUser.id.
        const { data: teamData } = await supabase
          .from('profiles')
          .select(
            'id, user_id, full_name, avatar_url, account_role, role, updated_at'
          )
          .eq('account_id', accountId || '')
          .limit(5);

        // 2. Fetch active clients (contacts) in the current account
        const { data: clientData } = await supabase
          .from('contacts')
          .select(
            'id, name, name_tag, phone, classification, requirements, updated_at'
          )
          .eq('account_id', accountId || '')
          .order('updated_at', { ascending: false })
          .limit(5);

        if (!active) return;

        const activeList: ActiveUser[] = [];

        // Process team members. The widget is "Live agent & client
        // statuses": the viewer never needs their own row, and the
        // account owner's activity is not the team's business — both
        // are skipped. Duplicate profile rows for the same auth user
        // (seen in the wild via the phone-match signup path) collapse
        // to one entry.
        const seenUserIds = new Set<string>();
        if (teamData && teamData.length > 0) {
          teamData.forEach((member) => {
            if (member.user_id && member.user_id === currentUser?.id) return;
            if (member.account_role === 'owner') return;
            const dedupeKey = member.user_id || member.id;
            if (seenUserIds.has(dedupeKey)) return;
            seenUserIds.add(dedupeKey);

            const lastUpdated = new Date(member.updated_at).getTime();
            const isRecent = Date.now() - lastUpdated < 15 * 60 * 1000; // 15 mins
            const status: 'Online' | 'Away' | 'Offline' = isRecent
              ? 'Online'
              : 'Away';

            // Construct initials
            const nameParts = member.full_name?.split(/\s+/) || [];
            const initials =
              nameParts.length > 0
                ? nameParts
                    .map((p: string) => p[0])
                    .join('')
                    .substring(0, 2)
                    .toUpperCase()
                : 'U';

            // Construct action based on role
            let action = 'Viewing Dashboard';
            if (member.account_role === 'admin') {
              action = 'Reviewing Analytics';
            } else if (member.account_role === 'coordinator') {
              action = 'Managing Inventory';
            } else if (member.account_role === 'agent') {
              action = 'Answering Inbox';
            }

            activeList.push({
              id: member.id,
              name: member.full_name || 'User',
              group: 'team',
              role: member.account_role
                ? member.account_role.charAt(0).toUpperCase() +
                  member.account_role.slice(1)
                : 'Team Member',
              status,
              action,
              avatar: initials,
            });
          });
        }

        // Process clients (take up to 3 most recently active)
        if (clientData && clientData.length > 0) {
          clientData.slice(0, 3).forEach((client) => {
            const lastUpdated = new Date(client.updated_at).getTime();
            const isRecent = Date.now() - lastUpdated < 30 * 60 * 1000; // 30 mins
            const status: 'Online' | 'Away' | 'Offline' = isRecent
              ? 'Online'
              : 'Away';

            const name = client.name || client.phone || 'Client';
            const nameParts = name.replace('+', '').split(/\s+/);
            const initials =
              nameParts.length > 0
                ? nameParts
                    .map((p: string) => p[0])
                    .join('')
                    .substring(0, 2)
                    .toUpperCase()
                : 'C';

            let action = 'Active on WhatsApp';
            if (client.requirements) {
              action =
                client.requirements.length > 30
                  ? client.requirements.substring(0, 27) + '...'
                  : client.requirements;
            } else if (client.classification === 'Buyer') {
              action = 'Searching listings';
            } else if (client.classification === 'Seller') {
              action = 'Listing properties';
            }

            activeList.push({
              id: client.id,
              name,
              nameTag: client.name_tag,
              group: 'client',
              role: client.classification || 'Client',
              status,
              action,
              avatar: initials,
            });
          });
        }

        if (activeList.length === 0) {
          setUsers(STATIC_FALLBACK_USERS);
        } else {
          // Sort online users to the top
          activeList.sort((a, b) => {
            if (a.status === b.status) return 0;
            return a.status === 'Online' ? -1 : 1;
          });
          setUsers(activeList);
        }
      } catch (err) {
        console.error('Failed to load active users:', err);
        if (active) setUsers(STATIC_FALLBACK_USERS);
      } finally {
        if (active) setLoading(false);
      }
    }

    if (accountId) {
      loadActiveUsers();
    } else {
      setUsers(STATIC_FALLBACK_USERS);
      setLoading(false);
    }

    return () => {
      active = false;
    };
  }, [accountId, currentUser, supabase]);

  if (loading) {
    return (
      <section className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-2xl border border-slate-800/80 bg-slate-900/45 shadow-md backdrop-blur-sm">
        <div className="border-primary h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
      </section>
    );
  }

  return (
    <section className="hover:border-primary/20 group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/45 shadow-md backdrop-blur-sm transition-all duration-300">
      <header className="flex items-center justify-between border-b border-slate-900/60 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Active Users</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Live agent & client statuses
          </p>
        </div>
      </header>

      <div className="max-h-[350px] flex-1 space-y-4 overflow-y-auto p-5">
        {USER_GROUPS.map(({ group, label }) => {
          const members = users.filter((u) => u.group === group);
          if (members.length === 0) return null;
          return (
            <div key={group} className="space-y-2">
              <h3 className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                {label}
              </h3>
              {members.map((u) => (
                <div
                  key={u.id}
                  className="hover:border-slate-850 flex items-center gap-3.5 rounded-xl border border-slate-900 bg-slate-950/20 p-3 transition-all duration-200 hover:bg-slate-950/40"
                >
                  <Avatar className="size-9 shrink-0 border border-slate-800">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-black">
                      {u.avatar}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-xs font-black text-white">
                          {u.name}
                        </span>
                        <NameTagBadge tag={u.nameTag} />
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold ${
                          u.status === 'Online'
                            ? 'text-emerald-400'
                            : u.status === 'Away'
                              ? 'text-amber-400'
                              : 'text-slate-500'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            u.status === 'Online'
                              ? 'animate-pulse bg-emerald-500'
                              : u.status === 'Away'
                                ? 'bg-amber-500'
                                : 'bg-slate-500'
                          }`}
                        />
                        {u.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                      {u.role}
                    </p>

                    {/* Status Badge */}
                    <div className="mt-2 inline-flex max-w-full items-center truncate rounded-lg border border-slate-900 bg-slate-950/60 px-2 py-0.5 text-[9px] font-bold text-slate-300">
                      {u.action}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
