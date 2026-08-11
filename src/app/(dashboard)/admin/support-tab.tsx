'use client';

// ============================================================
// Admin → Support — the help-desk queue behind the copilot's "Ask
// the support team" button.
//
// Tickets arrive when the helper couldn't answer (or only partly
// could); each carries the question, the helper's last reply, the
// coverage verdict and the requester's chosen reply channel. Assign
// one to yourself, write the answer, and Send delivers it over that
// channel — WhatsApp from the platform sender, or email via Resend —
// and stamps what actually went out.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import { ChevronDown, LifeBuoy, Mail, MessageCircle } from 'lucide-react';

import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { cn } from '@/lib/utils';

type TicketStatus = 'open' | 'assigned' | 'answered' | 'closed';

interface SupportTicket {
  id: string;
  reference: string;
  question: string;
  helper_reply: string | null;
  coverage: string | null;
  platform: string;
  pathname: string | null;
  preferred_channel: 'whatsapp' | 'email';
  contact_phone: string | null;
  contact_email: string | null;
  status: TicketStatus;
  assigned_to_user_id: string | null;
  answer: string | null;
  answered_at: string | null;
  answer_sent_via: string[];
  created_at: string;
  account_id: string;
  accounts: { name: string } | null;
}

const STATUS_STYLE: Record<TicketStatus, string> = {
  open: 'border-amber-500/30 bg-amber-500/15 text-amber-400',
  assigned: 'border-sky-500/30 bg-sky-500/15 text-sky-400',
  answered: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
  closed: 'border-slate-600/40 bg-slate-700/40 text-slate-400',
};

export default function SupportTab() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/support-tickets');
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error || 'Could not load support tickets');
        return;
      }
      const data = (await res.json()) as { tickets: SupportTicket[] };
      setTickets(data.tickets);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (
    ticket: SupportTicket,
    body: { action: string; answer?: string }
  ) => {
    setBusy(ticket.id);
    try {
      const res = await fetch('/api/admin/support-tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ticket.id, ...body }),
      });
      const data = (await res.json()) as {
        error?: string;
        sentVia?: string[];
      };
      if (!res.ok) {
        toast.error(data.error || 'Action failed');
        return;
      }
      if (body.action === 'answer') {
        toast.success(
          data.sentVia?.length
            ? `Answer sent via ${data.sentVia.join(' + ')}`
            : 'Answer saved — delivery failed, follow up manually'
        );
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const totals = useMemo(
    () => ({
      open: tickets.filter((t) => t.status === 'open').length,
      assigned: tickets.filter((t) => t.status === 'assigned').length,
      answered: tickets.filter((t) => t.status === 'answered').length,
    }),
    [tickets]
  );

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <ConvoRealLoader size={26} label="Loading support tickets" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Open" value={totals.open} />
        <Stat label="Assigned" value={totals.assigned} />
        <Stat label="Answered" value={totals.answered} />
      </div>

      {tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 py-16 text-center">
          <LifeBuoy className="size-6 text-slate-600" />
          <p className="text-sm text-slate-400">No support tickets yet.</p>
          <p className="max-w-sm text-xs text-slate-600">
            Tickets appear when a user asks the in-app helper something it
            can&apos;t answer and taps &ldquo;Ask the support team&rdquo;.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tickets.map((t) => {
            const open = expanded === t.id;
            const draft = drafts[t.id] ?? '';
            return (
              <div
                key={t.id}
                className="rounded-xl border border-slate-800 bg-slate-900/50"
              >
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : t.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="shrink-0 font-mono text-xs text-slate-500">
                    {t.reference}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase',
                      STATUS_STYLE[t.status]
                    )}
                  >
                    {t.status}
                  </span>
                  <span className="flex-1 truncate text-sm font-semibold text-white">
                    {t.question}
                  </span>
                  <span className="hidden shrink-0 text-xs text-slate-500 sm:block">
                    {t.accounts?.name ?? 'Unknown account'}
                  </span>
                  <span className="shrink-0 text-slate-500">
                    {t.preferred_channel === 'whatsapp' ? (
                      <MessageCircle className="size-3.5" />
                    ) : (
                      <Mail className="size-3.5" />
                    )}
                  </span>
                  <span className="hidden shrink-0 text-xs text-slate-500 sm:block">
                    {formatDistanceToNowStrict(new Date(t.created_at), {
                      addSuffix: true,
                    })}
                  </span>
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 text-slate-500 transition-transform',
                      open && 'rotate-180'
                    )}
                  />
                </button>
                {open && (
                  <div className="flex flex-col gap-3 border-t border-slate-800/80 px-4 py-3 text-xs">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-500">
                      <span>Platform: {t.platform}</span>
                      {t.coverage && <span>Coverage: {t.coverage}</span>}
                      {t.pathname && <span>Asked from: {t.pathname}</span>}
                      <span>
                        Reply to:{' '}
                        {t.preferred_channel === 'whatsapp'
                          ? t.contact_phone
                          : t.contact_email}
                      </span>
                    </div>
                    {t.helper_reply && (
                      <p className="rounded-lg bg-slate-900 px-3 py-2 text-slate-400">
                        Helper answered: &ldquo;{t.helper_reply}&rdquo;
                      </p>
                    )}
                    {t.answer ? (
                      <div>
                        <p className="text-slate-500">
                          Answered{' '}
                          {t.answered_at &&
                            formatDistanceToNowStrict(new Date(t.answered_at), {
                              addSuffix: true,
                            })}
                          {t.answer_sent_via.length > 0 &&
                            ` · sent via ${t.answer_sent_via.join(' + ')}`}
                          {t.answer_sent_via.length === 0 &&
                            ' · delivery failed'}
                        </p>
                        <p className="mt-1 text-slate-300">{t.answer}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={draft}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [t.id]: e.target.value,
                            }))
                          }
                          rows={3}
                          placeholder={`Write the answer — it will be sent on ${t.preferred_channel}…`}
                          className="focus:border-primary/50 w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy === t.id || !draft.trim()}
                            onClick={() =>
                              act(t, { action: 'answer', answer: draft })
                            }
                            className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                          >
                            Send answer
                          </button>
                          {t.status === 'open' && (
                            <button
                              type="button"
                              disabled={busy === t.id}
                              onClick={() => act(t, { action: 'assign' })}
                              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
                            >
                              Assign to me
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy === t.id}
                            onClick={() => act(t, { action: 'close' })}
                            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-500"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="font-mono text-2xl font-bold text-white tabular-nums">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </div>
  );
}
