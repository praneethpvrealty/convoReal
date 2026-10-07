'use client';

// ============================================================
// Admin → Bot replies — the nightly bot thread review queue.
//
// Every conversation the bot wrote in yesterday was read back as one
// thread by the transcript rules and the model judge. This tab lists
// the ones that failed or could not be scored, shows the thread as the
// lead saw it with the issues beside it, takes the platform's own
// verdict (good / bad), and copies a bad thread out as a fixture for
// src/lib/whatsapp/inbound/transcripts/fixtures, where the rules must
// keep catching it.
// ============================================================

import { useMemo, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import {
  Bot,
  ChevronDown,
  Copy,
  ThumbsDown,
  ThumbsUp,
  Undo2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { cn } from '@/lib/utils';
import { fixtureFromReview } from '@/lib/whatsapp/inbound/transcripts/fixture-export';

type Verdict = 'pass' | 'fail' | 'unscored';
type AdminVerdict = 'good' | 'bad' | null;

interface TranscriptBubble {
  sender: 'customer' | 'bot' | 'agent';
  kind: 'text' | 'template' | 'interactive' | 'media' | 'other';
  text: string;
  templateName?: string | null;
  at?: string;
}

interface ThreadReview {
  id: string;
  account_id: string;
  conversation_id: string;
  contact_id: string | null;
  review_day: string;
  transcript: TranscriptBubble[];
  rule_violations: Array<{ rule: string; index: number; note: string }>;
  score: number | null;
  verdict: Verdict;
  issues: Array<{ kind: string; message_index: number | null; note: string }>;
  summary: string | null;
  admin_verdict: AdminVerdict;
  admin_note: string | null;
  reviewed_at: string;
  accounts: { name: string } | null;
  contacts: { name: string | null; created_at: string | null } | null;
}

type Filter = 'attention' | 'fail' | 'pass' | 'all';

const VERDICT_STYLE: Record<Verdict, string> = {
  fail: 'border-rose-500/30 bg-rose-500/15 text-rose-300',
  pass: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
  unscored: 'border-amber-500/30 bg-amber-500/15 text-amber-400',
};

interface ReviewPage {
  reviews: ThreadReview[];
  nextCursor: string | null;
}

async function fetchReviewPage(
  filter: Filter,
  before: string | null
): Promise<ReviewPage> {
  const params = new URLSearchParams();
  if (filter !== 'attention') params.set('verdict', filter);
  if (before) params.set('before', before);
  const query = params.toString();
  const res = await fetch(
    `/api/admin/bot-thread-reviews${query ? `?${query}` : ''}`
  );
  const json = (await res.json()) as ReviewPage & { error?: string };
  if (!res.ok)
    throw new Error(json.error || 'Could not load bot thread reviews');
  return { reviews: json.reviews, nextCursor: json.nextCursor ?? null };
}

export default function BotRepliesTab() {
  const [filter, setFilter] = useState<Filter>('attention');
  const [expanded, setExpanded] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const queryKey = ['admin', 'bot-thread-reviews', filter] as const;

  const {
    data,
    isPending,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchReviewPage(filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const reviews = useMemo(
    () => data?.pages.flatMap((page) => page.reviews) ?? [],
    [data]
  );

  const verdict = useMutation({
    mutationFn: async (args: {
      review: ThreadReview;
      adminVerdict: AdminVerdict;
    }) => {
      const res = await fetch('/api/admin/bot-thread-reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: args.review.id,
          adminVerdict: args.adminVerdict,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Could not save the verdict');
      return args;
    },
    onSuccess: ({ review, adminVerdict }) => {
      queryClient.setQueryData<{ pages: ReviewPage[]; pageParams: unknown[] }>(
        queryKey,
        (current) =>
          current && {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              reviews: page.reviews.map((row) =>
                row.id === review.id
                  ? { ...row, admin_verdict: adminVerdict }
                  : row
              ),
            })),
          }
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const mark = (review: ThreadReview, adminVerdict: AdminVerdict) =>
    verdict.mutate({ review, adminVerdict });
  const busy = verdict.isPending ? verdict.variables?.review.id : null;

  const copyFixture = async (review: ThreadReview) => {
    try {
      await navigator.clipboard.writeText(fixtureFromReview(review));
      toast.success(
        'Fixture copied — save it under src/lib/whatsapp/inbound/transcripts/fixtures and change the names'
      );
    } catch {
      toast.error('Clipboard unavailable');
    }
  };

  const totals = useMemo(
    () => ({
      fail: reviews.filter((r) => r.verdict === 'fail').length,
      unscored: reviews.filter((r) => r.verdict === 'unscored').length,
      bad: reviews.filter((r) => r.admin_verdict === 'bad').length,
    }),
    [reviews]
  );

  if (isPending) {
    return (
      <div className="flex h-96 items-center justify-center">
        <ConvoRealLoader size={26} label="Loading bot thread reviews" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
        {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ['Failed', totals.fail, 'text-rose-300'],
            ['Unscored', totals.unscored, 'text-amber-400'],
            ['Marked bad', totals.bad, 'text-slate-200'],
          ] as const
        ).map(([label, count, tone]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"
          >
            <div className="text-xs tracking-wide text-slate-400 uppercase">
              {label}
            </div>
            <div className={cn('mt-1 text-2xl font-semibold', tone)}>
              {count}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['attention', 'Needs a look'],
            ['fail', 'Failed'],
            ['pass', 'Passed'],
            ['all', 'All'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filter === value
                ? 'border-primary bg-primary/15 text-white'
                : 'border-slate-700 text-slate-400 hover:text-white'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {reviews.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 py-16 text-center">
          <Bot className="h-8 w-8 text-slate-500" />
          <p className="text-sm text-slate-300">
            No reviewed threads here yet.
          </p>
          <p className="text-xs text-slate-500">
            The review runs nightly at 05:00 IST over every thread the bot wrote
            in.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {reviews.map((review) => {
            const open = expanded === review.id;
            const violations = [
              ...new Set(review.rule_violations.map((v) => v.rule)),
            ];
            return (
              <div
                key={review.id}
                className="rounded-xl border border-slate-800 bg-slate-900/50"
              >
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : review.id)}
                  className="flex w-full items-start gap-3 p-4 text-left"
                >
                  <span
                    className={cn(
                      'mt-0.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase',
                      VERDICT_STYLE[review.verdict]
                    )}
                  >
                    {review.verdict}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 text-sm text-slate-200">
                      <span className="font-medium">
                        {review.contacts?.name || 'Unnamed lead'}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-400">
                        {review.accounts?.name ?? review.account_id}
                      </span>
                      {review.score !== null && (
                        <>
                          <span className="text-slate-500">·</span>
                          <span className="text-slate-400">
                            {review.score}/100
                          </span>
                        </>
                      )}
                      {review.admin_verdict && (
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[11px]',
                            review.admin_verdict === 'bad'
                              ? 'border-rose-500/30 text-rose-300'
                              : 'border-emerald-500/30 text-emerald-300'
                          )}
                        >
                          marked {review.admin_verdict}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {review.summary ||
                        `${review.transcript.length} bubbles, reviewed ${formatDistanceToNowStrict(new Date(review.reviewed_at))} ago`}
                    </div>
                    {violations.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {violations.map((rule) => (
                          <span
                            key={rule}
                            className="rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-200"
                          >
                            {rule}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <ChevronDown
                    className={cn(
                      'mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform',
                      open && 'rotate-180'
                    )}
                  />
                </button>

                {open && (
                  <div className="flex flex-col gap-3 border-t border-slate-800 p-4">
                    <div className="flex flex-col gap-2">
                      {review.transcript.map((bubble, index) => {
                        const notes = [
                          ...review.rule_violations
                            .filter((v) => v.index === index)
                            .map((v) => `${v.rule}: ${v.note}`),
                          ...review.issues
                            .filter((i) => i.message_index === index)
                            .map((i) => `${i.kind}: ${i.note}`),
                        ];
                        return (
                          <div
                            key={index}
                            className={cn(
                              'max-w-[85%] rounded-lg px-3 py-2 text-xs whitespace-pre-wrap',
                              bubble.sender === 'customer'
                                ? 'self-start border border-slate-700 bg-slate-950 text-slate-200'
                                : 'self-end border border-emerald-500/20 bg-emerald-500/10 text-slate-100'
                            )}
                          >
                            <div className="mb-1 text-[10px] tracking-wide text-slate-500 uppercase">
                              {index} · {bubble.sender}
                              {bubble.templateName
                                ? ` · ${bubble.templateName}`
                                : bubble.kind !== 'text'
                                  ? ` · ${bubble.kind}`
                                  : ''}
                            </div>
                            {bubble.text}
                            {notes.length > 0 && (
                              <ul className="mt-2 list-disc pl-4 text-[11px] text-rose-200">
                                {notes.map((note) => (
                                  <li key={note}>{note}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {review.issues.some((i) => i.message_index === null) && (
                      <ul className="list-disc pl-4 text-xs text-amber-200">
                        {review.issues
                          .filter((i) => i.message_index === null)
                          .map((i) => (
                            <li key={`${i.kind}-${i.note}`}>
                              {i.kind}: {i.note}
                            </li>
                          ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-slate-700"
                        disabled={busy === review.id}
                        onClick={() => mark(review, 'good')}
                      >
                        <ThumbsUp className="mr-1.5 h-3.5 w-3.5" /> Good
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-slate-700"
                        disabled={busy === review.id}
                        onClick={() => mark(review, 'bad')}
                      >
                        <ThumbsDown className="mr-1.5 h-3.5 w-3.5" /> Bad
                      </Button>
                      {review.admin_verdict && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === review.id}
                          onClick={() => mark(review, null)}
                        >
                          <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Clear
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto border-slate-700"
                        onClick={() => copyFixture(review)}
                      >
                        <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy as fixture
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {hasNextPage && (
            <Button
              variant="outline"
              className="self-center border-slate-700"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load older threads'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
