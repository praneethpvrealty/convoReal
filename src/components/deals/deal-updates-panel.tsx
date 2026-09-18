'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  Lock,
  Megaphone,
  Send,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DEAL_EVENT_LABELS, type DealEvent } from '@/lib/deals/events';
import type { DealMilestoneStatus } from '@/lib/deals/milestones';
import {
  DEAL_SHARE_TTL_CHOICES,
  DEFAULT_DEAL_SHARE_TTL_KEY,
  type DealShareTtlKey,
} from '@/lib/deals/share-links';
import type { DealStakeholder } from '@/lib/deals/stakeholders';
import {
  DEAL_UPDATE_VISIBILITIES,
  isEligibleRecipient,
  recipientStage,
  snapshotItemAllowed,
  UPDATE_CHANNEL_LABELS,
  UPDATE_CHANNELS,
  UPDATE_STAGE_LABELS,
  type DealUpdate,
  type DealUpdateRecipient,
  type DealUpdateVisibility,
  type UpdateChannel,
  type UpdateRecipientStage,
} from '@/lib/deals/updates';
import {
  DEAL_VISIBILITY_LABELS,
  type DealVisibility,
} from '@/lib/deals/visibility';
import { cn } from '@/lib/utils';

interface MilestoneRow {
  id: string;
  title: string;
  status: DealMilestoneStatus;
  visibility: DealVisibility;
}

type RecipientRow = DealUpdateRecipient & {
  stakeholder: { id: string; name: string; role: string; side: string } | null;
  url?: string;
  notice?: string;
  handoff_url?: string;
};

type UpdateRow = DealUpdate & { recipients: RecipientRow[] };

interface PreviewRecipient {
  stakeholder_id: string;
  name: string;
  channel: UpdateChannel;
  eligible: boolean;
  mode: string | null;
  reason: string | null;
  needs_email: boolean;
  text: string;
}

interface DealUpdatesPanelProps {
  dealId: string;
  canEdit: boolean;
}

const STAGE_TONE: Record<UpdateRecipientStage, string> = {
  pending: 'border-amber-500/40 text-amber-200',
  sent: 'border-slate-600 text-slate-300',
  opened: 'border-sky-500/40 text-sky-200',
  acknowledged: 'border-emerald-500/40 text-emerald-200',
  failed: 'border-rose-500/40 text-rose-200',
};

async function call(path: string, init: RequestInit, failure: string) {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error || failure);
  return json;
}

export function DealUpdatesPanel({ dealId, canEdit }: DealUpdatesPanelProps) {
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState<{
    supersedes: UpdateRow | null;
  } | null>(null);
  const [handoffs, setHandoffs] = useState<RecipientRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: updates = [], isLoading } = useQuery({
    queryKey: ['deal-updates', dealId],
    queryFn: async (): Promise<UpdateRow[]> => {
      const response = await fetch(`/api/deals/${dealId}/updates`);
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load updates');
      return json.data ?? [];
    },
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['deal-updates', dealId] }),
      queryClient.invalidateQueries({ queryKey: ['deal-events', dealId] }),
      queryClient.invalidateQueries({
        queryKey: ['deal-stakeholders', dealId],
      }),
    ]);

  async function markSent(r: RecipientRow) {
    setBusy(r.id);
    try {
      await call(
        `/api/deals/${dealId}/updates/${r.update_id}/recipients/${r.id}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'sent' }) },
        'Could not record'
      );
      setHandoffs((rows) => rows.filter((x) => x.id !== r.id));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Updates</h3>
          <p className="text-xs text-slate-400">
            What each side has been told, frozen at the moment it was published.
            A correction is a new update that names the one it replaces.
          </p>
        </div>
        {canEdit && !composing && (
          <Button size="sm" onClick={() => setComposing({ supersedes: null })}>
            <Megaphone className="h-4 w-4" />
            Compose update
          </Button>
        )}
      </div>

      {composing && (
        <UpdateComposer
          dealId={dealId}
          supersedes={composing.supersedes}
          onCancel={() => setComposing(null)}
          onPublished={async (rows) => {
            setComposing(null);
            setHandoffs(rows.filter((r) => r.url && r.status === 'pending'));
            await refresh();
          }}
        />
      )}

      {handoffs.length > 0 && (
        <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-amber-200">
            Hand these over now — the links will not be shown again.
          </p>
          {handoffs.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs"
            >
              <p className="font-medium text-white">{r.stakeholder?.name}</p>
              <p className="mt-1 break-all text-slate-400">{r.url}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(r.notice ?? r.url ?? '');
                    toast.success('Message copied');
                  }}
                >
                  <Copy className="h-4 w-4" />
                  Copy message
                </Button>
                {r.handoff_url && (
                  <a href={r.handoff_url} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline">
                      <ExternalLink className="h-4 w-4" />
                      Send on WhatsApp
                    </Button>
                  </a>
                )}
                <Button
                  size="sm"
                  onClick={() => markSent(r)}
                  disabled={busy === r.id}
                >
                  {busy === r.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Mark as sent
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading updates…
        </div>
      ) : updates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
          <Megaphone className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm font-medium text-slate-300">
            Nothing published yet
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Compose an update from the milestones a side may see and send each
            person their private link.
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {updates.map((u) => {
            const superseded = updates.some(
              (x) => x.supersedes_update_id === u.id
            );
            return (
              <li
                key={u.id}
                className={cn(
                  'rounded-xl border border-slate-800 bg-slate-900/50 p-4',
                  superseded && 'opacity-70'
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-white">
                      {u.supersedes_update_id ? 'Correction: ' : ''}
                      {u.headline}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {DEAL_VISIBILITY_LABELS[u.visibility]} ·{' '}
                      {formatDistanceToNow(new Date(u.created_at), {
                        addSuffix: true,
                      })}
                      {u.published_by_name ? ` · ${u.published_by_name}` : ''}
                      {superseded ? ' · corrected by a later update' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">
                      <Lock className="h-3 w-3" />
                      Snapshot
                    </span>
                    {canEdit && !superseded && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setComposing({ supersedes: u })}
                      >
                        <Undo2 className="h-4 w-4" />
                        Correct
                      </Button>
                    )}
                  </div>
                </div>
                {u.body && (
                  <p className="mt-2 text-sm whitespace-pre-line text-slate-300">
                    {u.body}
                  </p>
                )}
                {u.snapshot.milestones.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
                    {u.snapshot.milestones.map((m) => (
                      <li key={m.id}>
                        {m.status === 'completed'
                          ? '✅'
                          : m.status === 'in_progress'
                            ? '🔄'
                            : '⬜'}{' '}
                        {m.title}
                      </li>
                    ))}
                  </ul>
                )}
                {u.recipients.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                    {u.recipients.map((r) => {
                      const stage = recipientStage(r);
                      return (
                        <li
                          key={r.id}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]',
                            STAGE_TONE[stage]
                          )}
                          title={[
                            UPDATE_CHANNEL_LABELS[r.channel],
                            r.sent_at
                              ? `sent ${new Date(r.sent_at).toLocaleString()}`
                              : null,
                            r.opened_at
                              ? `opened ${new Date(r.opened_at).toLocaleString()}`
                              : null,
                            r.acknowledged_at
                              ? `acknowledged ${new Date(r.acknowledged_at).toLocaleString()} (${r.acknowledged_via})`
                              : null,
                            r.failed_reason,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          {stage === 'opened' && <Eye className="h-3 w-3" />}
                          {stage === 'acknowledged' && (
                            <Check className="h-3 w-3" />
                          )}
                          {r.stakeholder?.name ?? 'Recipient'} ·{' '}
                          {UPDATE_STAGE_LABELS[stage]}
                          {canEdit &&
                            stage === 'pending' &&
                            (r.delivery_mode === 'handoff' ||
                              r.delivery_mode === 'portal') && (
                              <button
                                type="button"
                                className="underline"
                                onClick={() => markSent(r)}
                                disabled={busy === r.id}
                              >
                                mark sent
                              </button>
                            )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function UpdateComposer({
  dealId,
  supersedes,
  onCancel,
  onPublished,
}: {
  dealId: string;
  supersedes: UpdateRow | null;
  onCancel: () => void;
  onPublished: (recipients: RecipientRow[]) => Promise<void>;
}) {
  const [headline, setHeadline] = useState(
    supersedes ? `Correction to: ${supersedes.headline}`.slice(0, 120) : ''
  );
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<DealUpdateVisibility>(
    supersedes?.visibility ?? 'buyer_side'
  );
  const [milestoneIds, setMilestoneIds] = useState<string[]>([]);
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<Record<string, UpdateChannel>>(
    {}
  );
  const [ttl, setTtl] = useState<DealShareTtlKey>(DEFAULT_DEAL_SHARE_TTL_KEY);
  const [otp, setOtp] = useState(false);
  const [preview, setPreview] = useState<PreviewRecipient[] | null>(null);
  const [busy, setBusy] = useState<'preview' | 'publish' | null>(null);

  const { data: milestones = [] } = useQuery({
    queryKey: ['deal-milestones', dealId],
    queryFn: async (): Promise<MilestoneRow[]> => {
      const response = await fetch(`/api/deals/${dealId}/milestones`);
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load milestones');
      return json.data ?? [];
    },
  });
  const { data: events = [] } = useQuery({
    queryKey: ['deal-events', dealId],
    queryFn: async (): Promise<DealEvent[]> => {
      const response = await fetch(`/api/deals/${dealId}/events`);
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load the timeline');
      return json.data ?? [];
    },
  });
  const { data: stakeholders = [] } = useQuery({
    queryKey: ['deal-stakeholders', dealId],
    queryFn: async (): Promise<DealStakeholder[]> => {
      const response = await fetch(`/api/deals/${dealId}/stakeholders`);
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load stakeholders');
      return json.data ?? [];
    },
  });

  const quotable = milestones.filter((m) =>
    snapshotItemAllowed(visibility, m.visibility)
  );
  const quotableEvents = events
    .filter((e) => snapshotItemAllowed(visibility, e.visibility))
    .filter((e) => e.event_type !== 'update_published')
    .slice(0, 30);
  const eligible = stakeholders.filter((s) =>
    isEligibleRecipient(s, visibility)
  );

  const payload = () => ({
    headline,
    body: body || null,
    visibility,
    milestone_ids: milestoneIds.filter((id) =>
      quotable.some((m) => m.id === id)
    ),
    event_ids: eventIds.filter((id) => quotableEvents.some((e) => e.id === id)),
    supersedes_update_id: supersedes?.id ?? null,
    recipients: Object.entries(recipients)
      .filter(([id]) => eligible.some((s) => s.id === id))
      .map(([stakeholder_id, channel]) => ({ stakeholder_id, channel })),
    ttl,
    otp_required: otp,
    source: 'web',
  });

  async function runPreview() {
    setBusy('preview');
    try {
      const json = await call(
        `/api/deals/${dealId}/updates/preview`,
        { method: 'POST', body: JSON.stringify(payload()) },
        'Could not preview'
      );
      setPreview(json.data.recipients);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not preview');
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    setBusy('publish');
    try {
      const json = await call(
        `/api/deals/${dealId}/updates`,
        { method: 'POST', body: JSON.stringify(payload()) },
        'Could not publish'
      );
      toast.success('Update published');
      await onPublished(json.data.recipients ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not publish');
    } finally {
      setBusy(null);
    }
  }

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="upd-headline">Headline</Label>
          <Input
            id="upd-headline"
            maxLength={120}
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            className="border-slate-700 bg-slate-950"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="upd-body">Message (optional)</Label>
          <Textarea
            id="upd-body"
            rows={3}
            maxLength={1500}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="border-slate-700 bg-slate-950"
          />
        </div>
        <div>
          <Label htmlFor="upd-audience">Audience</Label>
          <select
            id="upd-audience"
            className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white"
            value={visibility}
            onChange={(e) => {
              setVisibility(e.target.value as DealUpdateVisibility);
              setPreview(null);
            }}
          >
            {DEAL_UPDATE_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {DEAL_VISIBILITY_LABELS[v]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="upd-ttl">Links expire in</Label>
          <select
            id="upd-ttl"
            className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white"
            value={ttl}
            onChange={(e) => setTtl(e.target.value as DealShareTtlKey)}
          >
            {DEAL_SHARE_TTL_CHOICES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-300">
          Milestones to quote
        </p>
        <p className="text-[11px] text-slate-500">
          Only milestones this audience may already see are offered.
        </p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {quotable.map((m) => (
            <li key={m.id}>
              <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={milestoneIds.includes(m.id)}
                  onChange={() => setMilestoneIds((ids) => toggle(ids, m.id))}
                />
                {m.title}
                <span className="text-[11px] text-slate-500">
                  {m.status.replace('_', ' ')}
                </span>
              </label>
            </li>
          ))}
          {quotable.length === 0 && (
            <li className="text-xs text-slate-500">
              No milestone is visible to this audience yet.
            </li>
          )}
        </ul>
      </div>

      {quotableEvents.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-300">
            Timeline entries to quote
          </p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {quotableEvents.map((e) => (
              <li key={e.id}>
                <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={eventIds.includes(e.id)}
                    onChange={() => setEventIds((ids) => toggle(ids, e.id))}
                  />
                  <span className="truncate">{e.title}</span>
                  <span className="text-[11px] text-slate-500">
                    {DEAL_EVENT_LABELS[e.event_type] ?? e.event_type}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-slate-300">Recipients</p>
        <p className="text-[11px] text-slate-500">
          The business number sends free-form inside their 24-hour window and
          the Purchase progress template to a buyer outside it. Your own phone
          is a handoff the app never sends.
        </p>
        <ul className="mt-2 space-y-1.5">
          {eligible.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <label className="inline-flex items-center gap-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={s.id in recipients}
                  onChange={(e) => {
                    setPreview(null);
                    setRecipients((r) => {
                      const next = { ...r };
                      if (e.target.checked)
                        next[s.id] = s.phone
                          ? 'engine_whatsapp'
                          : 'portal_only';
                      else delete next[s.id];
                      return next;
                    });
                  }}
                />
                {s.name}
              </label>
              {s.id in recipients && (
                <select
                  aria-label={`Channel for ${s.name}`}
                  className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white"
                  value={recipients[s.id]}
                  onChange={(e) => {
                    setPreview(null);
                    setRecipients((r) => ({
                      ...r,
                      [s.id]: e.target.value as UpdateChannel,
                    }));
                  }}
                >
                  {UPDATE_CHANNELS.map((c) => (
                    <option
                      key={c}
                      value={c}
                      disabled={c !== 'portal_only' && !s.phone}
                    >
                      {UPDATE_CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </select>
              )}
            </li>
          ))}
          {eligible.length === 0 && (
            <li className="text-xs text-slate-500">
              Add a stakeholder on this side first.
            </li>
          )}
        </ul>
        <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={otp}
            onChange={(e) => setOtp(e.target.checked)}
          />
          Require a one-time code on these links (needs an email for each
          recipient)
        </label>
      </div>

      {preview && (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs font-semibold text-slate-300">
            Preview per recipient
          </p>
          {preview.length === 0 && (
            <p className="text-xs text-slate-500">
              No recipients selected — the update will only appear on existing
              links.
            </p>
          )}
          {preview.map((p) => (
            <div
              key={p.stakeholder_id}
              className="rounded-md border border-slate-800 p-2 text-xs"
            >
              <p className="font-medium text-white">
                {p.name} · {UPDATE_CHANNEL_LABELS[p.channel]}
                {p.mode ? ` · ${p.mode.replace('_', ' ')}` : ''}
              </p>
              {p.reason && <p className="mt-1 text-rose-300">{p.reason}</p>}
              {p.needs_email && (
                <p className="mt-1 text-amber-300">
                  Needs an email for the one-time code.
                </p>
              )}
              {p.mode === 'template' ? (
                <p className="mt-1 text-slate-400">
                  Their window is closed: the Purchase progress template goes
                  with the headline as the current step, and the private link
                  follows the moment they tap a reply.
                </p>
              ) : (
                <pre className="mt-1 font-sans whitespace-pre-wrap text-slate-300">
                  {p.text}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={runPreview}
          disabled={!headline.trim() || busy !== null}
        >
          {busy === 'preview' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          Preview
        </Button>
        <Button
          size="sm"
          onClick={publish}
          disabled={!headline.trim() || busy !== null}
        >
          {busy === 'publish' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Publish
        </Button>
      </div>
    </div>
  );
}
