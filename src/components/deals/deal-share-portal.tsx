'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Check,
  FileText,
  Loader2,
  Lock,
  Megaphone,
  ShieldCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  ExternalDealView,
  ExternalPortalView,
  ExternalUpdateView,
} from '@/lib/deals/external-view';
import { DEAL_MILESTONE_STATUS_LABELS } from '@/lib/deals/milestones';
import {
  STAKEHOLDER_ROLE_LABELS,
  type StakeholderRole,
} from '@/lib/deals/stakeholders';
import { cn } from '@/lib/utils';

interface Acknowledgement {
  update_id: string;
  opened_at: string | null;
  acknowledged_at: string | null;
}

type PortalState =
  | { kind: 'loading' }
  | { kind: 'dead'; message: string }
  | { kind: 'locked'; stakeholderName: string; channel: 'email' | null }
  | {
      kind: 'open';
      view: ExternalPortalView;
      expiresAt: string;
      acknowledgements: Acknowledgement[];
    };

interface DealSharePortalProps {
  token: string;
}

function unlockKey(token: string) {
  return `deal-share-unlock:${token.slice(0, 12)}`;
}

export function DealSharePortal({ token }: DealSharePortalProps) {
  const [unlock, setUnlock] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return sessionStorage.getItem(unlockKey(token));
    } catch {
      return null;
    }
  });

  const openedUpdate =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('u');

  const { data: state = { kind: 'loading' } as PortalState } = useQuery({
    queryKey: ['deal-share', token, unlock],
    queryFn: async (): Promise<PortalState> => {
      const response = await fetch(
        `/api/public/deal-share/${encodeURIComponent(token)}${openedUpdate ? `?u=${encodeURIComponent(openedUpdate)}` : ''}`,
        {
          headers: unlock ? { 'X-Deal-Unlock': unlock } : {},
          cache: 'no-store',
        }
      );
      const json = await response.json().catch(() => null);
      if (response.status === 410) {
        return {
          kind: 'dead',
          message: json?.error || 'This link has expired.',
        };
      }
      if (!response.ok) {
        return {
          kind: 'dead',
          message:
            'This link is not available. Ask the agent who shared it for a fresh one.',
        };
      }
      if (json.data.locked) {
        return {
          kind: 'locked',
          stakeholderName: json.data.stakeholder_name,
          channel: json.data.channel,
        };
      }
      const {
        locked: _l,
        expires_at,
        acknowledgements,
        ...view
      } = json.data as ExternalPortalView & {
        locked: boolean;
        expires_at: string;
        acknowledgements: Acknowledgement[];
      };
      void _l;
      return {
        kind: 'open',
        view,
        expiresAt: expires_at,
        acknowledgements: acknowledgements ?? [],
      };
    },
    retry: false,
    staleTime: 0,
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
        {state.kind === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Opening your transaction…
          </div>
        )}
        {state.kind === 'dead' && <DeadLink message={state.message} />}
        {state.kind === 'locked' && (
          <OtpGate
            token={token}
            stakeholderName={state.stakeholderName}
            channel={state.channel}
            onUnlocked={(value) => {
              try {
                sessionStorage.setItem(unlockKey(token), value);
              } catch {
                // Session storage may be unavailable; the unlock still works for this load.
              }
              setUnlock(value);
            }}
          />
        )}
        {state.kind === 'open' && (
          <PortalBody
            token={token}
            view={state.view}
            expiresAt={state.expiresAt}
            unlock={unlock}
            acknowledgements={state.acknowledgements}
            highlight={openedUpdate}
          />
        )}
      </div>
    </div>
  );
}

function DeadLink({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center">
      <h1 className="text-xl font-bold">Transaction not available</h1>
      <p className="mt-2 text-sm text-slate-400">{message}</p>
    </div>
  );
}

function OtpGate({
  token,
  stakeholderName,
  channel,
  onUnlocked,
}: {
  token: string;
  stakeholderName: string;
  channel: 'email' | null;
  onUnlocked: (unlock: string) => void;
}) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/public/deal-share/${encodeURIComponent(token)}/otp`,
        {
          method: 'POST',
        }
      );
      const json = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(json?.error || 'Could not send the code');
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/public/deal-share/${encodeURIComponent(token)}/otp/verify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        }
      );
      const json = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(json?.error || 'That code is not right');
      onUnlocked(json.data.unlock as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code is not right');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8">
      <div className="flex items-center gap-2 text-emerald-300">
        <ShieldCheck className="h-5 w-5" />
        <h1 className="text-lg font-bold text-white">Verify it&apos;s you</h1>
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Hi {stakeholderName}. This transaction contains sensitive documents, so
        we&apos;ll send a one-time code
        {channel === 'email' ? ' to your email' : ''} before opening it.
      </p>
      {channel === null ? (
        <p className="mt-4 text-sm text-amber-300">
          There is no email on file for you. Ask the agent to add one, then open
          the link again.
        </p>
      ) : !sent ? (
        <Button className="mt-4" onClick={send} disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Lock className="h-4 w-4" />
          )}
          Send my code
        </Button>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="border-slate-700 bg-slate-950 text-center text-lg tracking-widest"
            />
          </div>
          <Button onClick={verify} disabled={busy || code.length !== 6}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Open
          </Button>
          <button
            type="button"
            className="text-xs text-slate-400 underline"
            onClick={send}
          >
            Send again
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
    </div>
  );
}

function PortalBody({
  token,
  view,
  expiresAt,
  unlock,
  acknowledgements,
  highlight,
}: {
  token: string;
  view: ExternalPortalView;
  expiresAt: string;
  unlock: string | null;
  acknowledgements: Acknowledgement[];
  highlight: string | null;
}) {
  const role =
    STAKEHOLDER_ROLE_LABELS[view.stakeholder.role as StakeholderRole] ??
    view.stakeholder.role;
  return (
    <>
      <header>
        <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
          Shared with {view.stakeholder.name} · {role}
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
          {view.deal.title}
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          This private link expires {new Date(expiresAt).toLocaleDateString()}.
          Do not forward it.
        </p>
      </header>

      {view.deal.updates.length > 0 && (
        <UpdatesSection
          token={token}
          updates={view.deal.updates}
          acknowledgements={acknowledgements}
          unlock={unlock}
          highlight={highlight}
        />
      )}
      <DealSection token={token} deal={view.deal} unlock={unlock} />
      {view.bundle.map((sibling) => (
        <DealSection
          key={sibling.id}
          token={token}
          deal={sibling}
          unlock={unlock}
          sibling
        />
      ))}
    </>
  );
}

function UpdatesSection({
  token,
  updates,
  acknowledgements,
  unlock,
  highlight,
}: {
  token: string;
  updates: ExternalUpdateView[];
  acknowledgements: Acknowledgement[];
  unlock: string | null;
  highlight: string | null;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge(updateId: string) {
    setBusy(updateId);
    setError(null);
    try {
      const response = await fetch(
        `/api/public/deal-share/${encodeURIComponent(token)}/updates/${updateId}/ack`,
        {
          method: 'POST',
          headers: unlock ? { 'X-Deal-Unlock': unlock } : {},
        }
      );
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error || 'Could not record');
      await queryClient.invalidateQueries({ queryKey: ['deal-share', token] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-emerald-300" />
        <h2 className="text-sm font-semibold">Updates for you</h2>
      </div>
      {updates.map((u) => {
        const mine = acknowledgements.find((a) => a.update_id === u.id);
        return (
          <article
            key={u.id}
            className={cn(
              'rounded-lg border border-slate-800 bg-slate-950/50 p-4',
              highlight === u.id && 'border-emerald-500/50',
              u.superseded && 'opacity-60'
            )}
          >
            <p className="text-[11px] text-slate-500">
              {new Date(u.created_at).toLocaleDateString()}
              {u.published_by_name ? ` · ${u.published_by_name}` : ''}
              {u.superseded ? ' · corrected by a later update' : ''}
              {u.supersedes_update_id ? ' · correction' : ''}
            </p>
            <h3 className="mt-1 font-semibold text-white">{u.headline}</h3>
            {u.body && (
              <p className="mt-2 text-sm whitespace-pre-line text-slate-300">
                {u.body}
              </p>
            )}
            {u.snapshot.milestones.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-sm text-slate-300">
                {u.snapshot.milestones.map((m) => (
                  <li key={m.id}>
                    {m.status === 'completed'
                      ? '✅'
                      : m.status === 'in_progress'
                        ? '🔄'
                        : '⬜'}{' '}
                    {m.title}
                    {m.target_date && m.status !== 'completed' ? (
                      <span className="text-slate-500">
                        {' '}
                        · by {m.target_date}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {u.snapshot.events.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-sm text-slate-400">
                {u.snapshot.events.map((e) => (
                  <li key={e.id}>• {e.title}</li>
                ))}
              </ul>
            )}
            {mine && (
              <div className="mt-3">
                {mine.acknowledged_at ? (
                  <p className="inline-flex items-center gap-1 text-xs text-emerald-300">
                    <Check className="h-3.5 w-3.5" />
                    Acknowledged{' '}
                    {new Date(mine.acknowledged_at).toLocaleDateString()}
                  </p>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => acknowledge(u.id)}
                    disabled={busy === u.id}
                  >
                    {busy === u.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Acknowledge
                  </Button>
                )}
              </div>
            )}
          </article>
        );
      })}
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <p className="text-[11px] text-slate-500">
        Each update is a record of what you were told at the time. A correction
        is published as a new update and the original stays.
      </p>
    </section>
  );
}

function DealSection({
  token,
  deal,
  unlock,
  sibling = false,
}: {
  token: string;
  deal: ExternalDealView;
  unlock: string | null;
  sibling?: boolean;
}) {
  const pct =
    deal.progress.total > 0
      ? Math.round((deal.progress.done / deal.progress.total) * 100)
      : 0;
  const docUrl = (id: string) =>
    `/api/public/deal-share/${encodeURIComponent(token)}/documents/${id}${unlock ? `?unlock=${encodeURIComponent(unlock)}` : ''}`;

  return (
    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      {sibling && (
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            Linked transaction
          </p>
          <h2 className="text-lg font-bold">{deal.title}</h2>
        </div>
      )}
      {deal.property_label && (
        <p className="text-sm text-slate-300">{deal.property_label}</p>
      )}

      <div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Progress</span>
          <span>
            {deal.progress.done} of {deal.progress.total} milestones
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-emerald-500/80"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {deal.milestones.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Milestones</h3>
          <ul className="mt-2 space-y-1.5">
            {deal.milestones.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full border',
                    m.status === 'completed'
                      ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                      : 'border-slate-600 text-transparent'
                  )}
                >
                  <Check className="h-3 w-3" />
                </span>
                <span
                  className={cn(
                    m.status === 'completed' && 'text-slate-400 line-through'
                  )}
                >
                  {m.title}
                </span>
                <span className="ml-auto text-[11px] text-slate-500">
                  {DEAL_MILESTONE_STATUS_LABELS[m.status]}
                  {m.target_date ? ` · by ${m.target_date}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {deal.timeline.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Updates</h3>
          <ol className="mt-2 space-y-1.5">
            {deal.timeline.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="text-slate-200">{e.title}</span>
                <span className="ml-2 text-[11px] text-slate-500">
                  {new Date(e.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {deal.documents.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Documents</h3>
          <ul className="mt-2 space-y-1.5">
            {deal.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-slate-500" />
                <a
                  href={docUrl(d.id)}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    'underline-offset-2 hover:underline',
                    d.superseded && 'text-slate-500 line-through'
                  )}
                >
                  {d.title}
                </a>
                {d.status && (
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">
                    {d.status}
                  </span>
                )}
                {d.expires_at && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <CalendarClock className="h-3 w-3" />
                    {d.expires_at}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-500">
            Photos carry your name as a watermark. Every open is recorded for
            the parties.
          </p>
        </div>
      )}
    </section>
  );
}
