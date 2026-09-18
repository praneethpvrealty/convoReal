'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Copy,
  ExternalLink,
  Eye,
  Link2,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEAL_SHARE_TTL_CHOICES,
  DEFAULT_DEAL_SHARE_TTL_KEY,
  linkState,
  SHARE_ACCESS_LABELS,
  type DealShareAccessEvent,
  type DealShareTtlKey,
} from '@/lib/deals/share-links';
import {
  defaultSideForRole,
  STAKEHOLDER_ROLE_LABELS,
  STAKEHOLDER_ROLES,
  STAKEHOLDER_SIDE_LABELS,
  STAKEHOLDER_SIDES,
  type DealStakeholder,
  type StakeholderRole,
} from '@/lib/deals/stakeholders';
import type { DealSide } from '@/lib/deals/visibility';
import { cn } from '@/lib/utils';

interface LinkRow {
  id: string;
  token_prefix: string;
  expires_at: string;
  revoked_at: string | null;
  otp_required: boolean;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

type StakeholderWithLinks = DealStakeholder & { links: LinkRow[] };

interface AccessRow {
  id: string;
  event: string;
  document_id: string | null;
  user_agent: string | null;
  created_at: string;
}

interface DealStakeholdersPanelProps {
  dealId: string;
  dealTitle: string;
  canEdit: boolean;
}

async function call(path: string, init: RequestInit, failure: string) {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error || failure);
  return json;
}

export function DealStakeholdersPanel({
  dealId,
  dealTitle,
  canEdit,
}: DealStakeholdersPanelProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<StakeholderRole>('buyer');
  const [side, setSide] = useState<DealSide>('buyer');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [ttl, setTtl] = useState<DealShareTtlKey>(DEFAULT_DEAL_SHARE_TTL_KEY);
  const [otp, setOtp] = useState(false);
  const [freshUrl, setFreshUrl] = useState<{
    stakeholderId: string;
    url: string;
  } | null>(null);
  const [logFor, setLogFor] = useState<string | null>(null);

  const { data: stakeholders = [], isLoading } = useQuery({
    queryKey: ['deal-stakeholders', dealId],
    queryFn: async (): Promise<StakeholderWithLinks[]> => {
      const response = await fetch(`/api/deals/${dealId}/stakeholders`);
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load stakeholders');
      return json.data ?? [];
    },
  });

  const { data: accessLog = [] } = useQuery({
    queryKey: ['deal-share-access', dealId, logFor],
    enabled: Boolean(logFor),
    queryFn: async (): Promise<AccessRow[]> => {
      const response = await fetch(
        `/api/deals/${dealId}/share-links/${logFor}/access`
      );
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load the access log');
      return json.data ?? [];
    },
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['deal-stakeholders', dealId],
      }),
      queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
    ]);

  async function add() {
    if (!name.trim()) return;
    setBusy('new');
    try {
      await call(
        `/api/deals/${dealId}/stakeholders`,
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            role,
            side,
            phone: phone || null,
            email: email || null,
            source: 'web',
          }),
        },
        'Could not add the stakeholder'
      );
      setName('');
      setPhone('');
      setEmail('');
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not add the stakeholder'
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(s: StakeholderWithLinks) {
    if (
      !window.confirm(`Remove ${s.name}? Their links stop working immediately.`)
    )
      return;
    setBusy(s.id);
    try {
      await call(
        `/api/deals/${dealId}/stakeholders/${s.id}`,
        { method: 'DELETE' },
        'Could not remove'
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove');
    } finally {
      setBusy(null);
    }
  }

  async function createLink(s: StakeholderWithLinks) {
    setBusy(`link:${s.id}`);
    try {
      const json = await call(
        `/api/deals/${dealId}/share-links`,
        {
          method: 'POST',
          body: JSON.stringify({
            stakeholder_id: s.id,
            ttl,
            otp_required: otp,
            source: 'web',
          }),
        },
        'Could not create the link'
      );
      setFreshUrl({ stakeholderId: s.id, url: json.data.url });
      setLinkFor(null);
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not create the link'
      );
    } finally {
      setBusy(null);
    }
  }

  async function revoke(link: LinkRow) {
    if (!window.confirm('Revoke this link? It stops working on the next open.'))
      return;
    setBusy(link.id);
    try {
      await call(
        `/api/deals/${dealId}/share-links/${link.id}`,
        { method: 'DELETE' },
        'Could not revoke'
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revoke');
    } finally {
      setBusy(null);
    }
  }

  function whatsappHandoff(s: StakeholderWithLinks, url: string) {
    const text = `Hi ${s.name}, here is your private link to the ${dealTitle} transaction: ${url}\nIt expires automatically. Please don't forward it.`;
    const digits = (s.phone ?? '').replace(/\D/g, '');
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Stakeholders</h3>
        <p className="text-xs text-slate-400">
          Everyone on this transaction, by side. A person on the buyer or seller
          side can be given a private link that shows only what their side may
          see. Nobody here gets a login.
        </p>
      </div>

      {canEdit && (
        <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="sh-name">Name</Label>
            <Input
              id="sh-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-slate-700 bg-slate-950"
            />
          </div>
          <div>
            <Label htmlFor="sh-role">Role</Label>
            <select
              id="sh-role"
              className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white"
              value={role}
              onChange={(e) => {
                const next = e.target.value as StakeholderRole;
                setRole(next);
                setSide(defaultSideForRole(next));
              }}
            >
              {STAKEHOLDER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {STAKEHOLDER_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="sh-side">Side</Label>
            <select
              id="sh-side"
              className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white"
              value={side}
              onChange={(e) => setSide(e.target.value as DealSide)}
            >
              {STAKEHOLDER_SIDES.map((s) => (
                <option key={s} value={s}>
                  {STAKEHOLDER_SIDE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="sh-phone">WhatsApp number</Label>
            <Input
              id="sh-phone"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="border-slate-700 bg-slate-950"
            />
          </div>
          <div>
            <Label htmlFor="sh-email">
              Email (needed for a code-protected link)
            </Label>
            <Input
              id="sh-email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-slate-700 bg-slate-950"
            />
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button onClick={add} disabled={!name.trim() || busy === 'new'}>
              {busy === 'new' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add stakeholder
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading stakeholders…
        </div>
      ) : stakeholders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
          <UserRound className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm font-medium text-slate-300">
            No stakeholders yet
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {stakeholders.map((s) => {
            const live = (s.links ?? []).filter(
              (l) => linkState(l) === 'active'
            );
            return (
              <li
                key={s.id}
                className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white">{s.name}</p>
                    <p className="text-xs text-slate-500">
                      {STAKEHOLDER_ROLE_LABELS[s.role]} ·{' '}
                      {STAKEHOLDER_SIDE_LABELS[s.side]}
                      {s.phone ? ` · +${s.phone}` : ''}
                      {s.email ? ` · ${s.email}` : ''}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      {s.side !== 'internal' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setLinkFor(linkFor === s.id ? null : s.id);
                            setFreshUrl(null);
                          }}
                        >
                          <Link2 className="h-4 w-4" />
                          Share link
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove(s)}
                        disabled={busy === s.id}
                        aria-label="Remove stakeholder"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                {linkFor === s.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-800 pt-3">
                    <div>
                      <Label htmlFor={`ttl-${s.id}`}>Expires in</Label>
                      <select
                        id={`ttl-${s.id}`}
                        className="h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white"
                        value={ttl}
                        onChange={(e) =>
                          setTtl(e.target.value as DealShareTtlKey)
                        }
                      >
                        {DEAL_SHARE_TTL_CHOICES.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={otp}
                        onChange={(e) => setOtp(e.target.checked)}
                        disabled={!s.email}
                      />
                      <ShieldCheck className="h-4 w-4" />
                      Require a one-time code
                      {!s.email ? ' (add an email first)' : ''}
                    </label>
                    <Button
                      size="sm"
                      onClick={() => createLink(s)}
                      disabled={busy === `link:${s.id}`}
                    >
                      {busy === `link:${s.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Link2 className="h-4 w-4" />
                      )}
                      Create link
                    </Button>
                  </div>
                )}

                {freshUrl?.stakeholderId === s.id && (
                  <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs">
                    <p className="font-semibold text-emerald-200">
                      Link created — copy it now. It will not be shown again.
                    </p>
                    <p className="mt-1 break-all text-slate-300">
                      {freshUrl.url}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void navigator.clipboard.writeText(freshUrl.url);
                          toast.success('Link copied');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                        Copy
                      </Button>
                      {s.phone && (
                        <a
                          href={whatsappHandoff(s, freshUrl.url)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Button size="sm" variant="outline">
                            <ExternalLink className="h-4 w-4" />
                            Send on WhatsApp
                          </Button>
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {(s.links ?? []).length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
                    {(s.links ?? [])
                      .slice()
                      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
                      .map((link) => {
                        const state = linkState(link);
                        return (
                          <li
                            key={link.id}
                            className="flex flex-wrap items-center gap-2 text-xs"
                          >
                            <span
                              className={cn(
                                'rounded-full border px-2 py-0.5',
                                state === 'active'
                                  ? 'border-emerald-500/40 text-emerald-300'
                                  : 'border-slate-700 text-slate-500'
                              )}
                            >
                              {state}
                            </span>
                            <span className="font-mono text-slate-400">
                              {link.token_prefix}…
                            </span>
                            {link.otp_required && (
                              <span className="inline-flex items-center gap-1 text-slate-400">
                                <ShieldCheck className="h-3 w-3" /> code
                              </span>
                            )}
                            <span className="text-slate-500">
                              expires{' '}
                              {new Date(link.expires_at).toLocaleDateString()} ·{' '}
                              {link.view_count} open
                              {link.view_count === 1 ? '' : 's'}
                            </span>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-slate-400 hover:text-white"
                              onClick={() =>
                                setLogFor(logFor === link.id ? null : link.id)
                              }
                            >
                              <Eye className="h-3 w-3" /> log
                            </button>
                            {canEdit && state === 'active' && (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-rose-300 hover:text-rose-200"
                                onClick={() => revoke(link)}
                                disabled={busy === link.id}
                              >
                                <Ban className="h-3 w-3" /> revoke
                              </button>
                            )}
                            {logFor === link.id && (
                              <ol className="w-full space-y-0.5 pl-2 text-[11px] text-slate-500">
                                {accessLog.length === 0 ? (
                                  <li>No opens yet.</li>
                                ) : (
                                  accessLog.map((row) => (
                                    <li key={row.id}>
                                      {new Date(
                                        row.created_at
                                      ).toLocaleString()}{' '}
                                      ·{' '}
                                      {SHARE_ACCESS_LABELS[
                                        row.event as DealShareAccessEvent
                                      ] ?? row.event}
                                    </li>
                                  ))
                                )}
                              </ol>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                )}
                {live.length === 0 &&
                  s.side !== 'internal' &&
                  (s.links ?? []).length > 0 && (
                    <p className="mt-2 text-[11px] text-slate-500">
                      No live link — create a fresh one to share again.
                    </p>
                  )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
