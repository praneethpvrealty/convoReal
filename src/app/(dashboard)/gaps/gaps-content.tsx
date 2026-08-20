'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  Check,
  CircleSlash,
  Clock,
  MessageCircleQuestion,
  Send,
  Sparkles,
  X,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { InfoHint } from '@/components/ui/info-hint';

type GapKind =
  | 'unanswered_question'
  | 'unkept_promise'
  | 'missing_next_step'
  | 'no_deal'
  | 'bot_handoff'
  | 'unmatched_requirement';

type Severity = 'high' | 'medium' | 'low';

interface GapRow {
  id: string;
  kind: GapKind;
  severity: Severity;
  summary: string;
  evidence: string;
  suggested_action: string | null;
  occurred_at: string;
  occurrence_count: number;
  channel: 'client' | 'personal_whatsapp';
  contact_id: string | null;
  conversation_id: string | null;
  contacts: { id: string; name: string | null } | null;
}

const KIND_META: Record<
  GapKind,
  { label: string; icon: typeof AlertTriangle; blurb: string }
> = {
  unanswered_question: {
    label: 'Unanswered',
    icon: MessageCircleQuestion,
    blurb: 'They asked; nobody replied.',
  },
  unkept_promise: {
    label: 'Promised',
    icon: Send,
    blurb: 'We said we would, and nothing shows that we did.',
  },
  missing_next_step: {
    label: 'No next step',
    icon: CalendarClock,
    blurb: 'An active thread with nothing scheduled.',
  },
  no_deal: {
    label: 'Not on a pipeline',
    icon: CircleSlash,
    blurb: 'Being worked, but tracked nowhere.',
  },
  bot_handoff: {
    label: 'Bot overridden',
    icon: Bot,
    blurb: 'An agent corrected the bot — it may be missing a fact.',
  },
  unmatched_requirement: {
    label: 'Nothing sent',
    icon: Sparkles,
    blurb: 'They told us what they want and got no shortlist.',
  },
};

const SEVERITY_STYLE: Record<Severity, string> = {
  high: 'border-rose-500/40 bg-rose-500/5 text-rose-300',
  medium: 'border-amber-500/40 bg-amber-500/5 text-amber-300',
  low: 'border-slate-700 bg-slate-800/40 text-slate-400',
};

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function relativeDay(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const hours = Math.round((Date.now() - then) / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

async function fetchGaps(): Promise<GapRow[]> {
  const res = await fetch('/api/sweep/gaps?status=open');
  if (!res.ok) throw new Error('Failed to load gaps');
  const body = (await res.json()) as { data: GapRow[] };
  return body.data ?? [];
}

export default function GapsContent() {
  const { accountId } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<GapKind | 'all'>('all');

  const gapsQuery = useQuery({
    queryKey: ['conversation-gaps', accountId],
    queryFn: fetchGaps,
    enabled: Boolean(accountId),
  });

  const close = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: 'resolved' | 'dismissed';
    }) => {
      const res = await fetch(`/api/sweep/gaps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Could not update this gap');
      }
      return status;
    },
    onSuccess: (status) => {
      toast.success(status === 'resolved' ? 'Marked done' : 'Dismissed');
      queryClient.invalidateQueries({
        queryKey: ['conversation-gaps', accountId],
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const gaps = useMemo(() => gapsQuery.data ?? [], [gapsQuery.data]);

  const counts = useMemo(() => {
    const out = new Map<GapKind, number>();
    for (const gap of gaps) out.set(gap.kind, (out.get(gap.kind) ?? 0) + 1);
    return out;
  }, [gaps]);

  const visible = useMemo(() => {
    const list =
      filter === 'all' ? gaps : gaps.filter((g) => g.kind === filter);
    return [...list].sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return b.occurrence_count - a.occurrence_count;
    });
  }, [gaps, filter]);

  if (gapsQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <ConvoRealLoader />
      </div>
    );
  }

  if (gapsQuery.isError) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-sm text-rose-300">
        Could not load the gap feed.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-white">
            Conversation gaps
            <InfoHint text="Every morning at 6am the Engine reads back over the last day of WhatsApp — yours and your team's — files what it learned onto the records, and lists here what got dropped. Nothing on this screen has messaged anyone." />
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {gaps.length
              ? `${gaps.length} open from the last sweep.`
              : 'Nothing outstanding. Yesterday looks clean.'}
          </p>
        </div>
      </div>

      {gaps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === 'all'
                ? 'border-primary bg-primary/10 text-white'
                : 'border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            All {gaps.length}
          </button>
          {([...counts.entries()] as [GapKind, number][]).map(
            ([kind, count]) => (
              <button
                key={kind}
                onClick={() => setFilter(kind)}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filter === kind
                    ? 'border-primary bg-primary/10 text-white'
                    : 'border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {KIND_META[kind].label} {count}
              </button>
            )
          )}
        </div>
      )}

      {visible.length === 0 && gaps.length > 0 && (
        <p className="text-sm text-slate-500">Nothing of that kind is open.</p>
      )}

      <div className="space-y-3">
        {visible.map((gap) => {
          const meta = KIND_META[gap.kind];
          const Icon = meta.icon;
          const busy = close.isPending && close.variables?.id === gap.id;

          return (
            <div
              key={gap.id}
              className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className={`shrink-0 rounded-lg border p-2 ${SEVERITY_STYLE[gap.severity]}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm leading-snug font-semibold text-white">
                      {gap.summary}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                      <span>{meta.label}</span>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {relativeDay(gap.occurred_at)}
                      </span>
                      {gap.occurrence_count > 1 && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="text-amber-400">
                            {gap.occurrence_count} days running
                          </span>
                        </>
                      )}
                      {gap.channel === 'personal_whatsapp' && (
                        <>
                          <span aria-hidden>·</span>
                          <span>your WhatsApp</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      close.mutate({ id: gap.id, status: 'resolved' })
                    }
                    title="I have handled this"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      close.mutate({ id: gap.id, status: 'dismissed' })
                    }
                    title="This was never a gap"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* The quote, not the model's reading of it — this is what
                  is actually being judged. */}
              <blockquote className="rounded-lg border-l-2 border-slate-700 bg-slate-950/50 px-3 py-2 text-xs whitespace-pre-wrap text-slate-300">
                {gap.evidence}
              </blockquote>

              {gap.suggested_action && (
                <p className="text-xs text-slate-400">
                  <span className="text-slate-500">Suggested: </span>
                  {gap.suggested_action}
                </p>
              )}

              {gap.conversation_id && (
                <a
                  href={`/inbox?conversation=${gap.conversation_id}`}
                  className="text-primary inline-block text-xs font-semibold hover:underline"
                >
                  Open the conversation →
                </a>
              )}
            </div>
          );
        })}
      </div>

      {gaps.length === 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
          <Check className="mx-auto h-8 w-8 text-emerald-400" />
          <p className="mt-3 text-sm font-semibold text-white">
            Nothing dropped
          </p>
          <p className="mt-1 text-xs text-slate-500">
            The last sweep found no unanswered questions, unkept promises or
            untracked conversations.
          </p>
        </div>
      )}
    </div>
  );
}
