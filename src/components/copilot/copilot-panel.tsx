'use client';

// ============================================================
// The helper chat panel: greeting, quick-suggestion chips, the
// guided-tour list, and a free-form chat wired to POST /api/copilot.
// History is held in component state only (last 6 turns are sent to
// the API) — nothing is persisted.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Compass,
  LifeBuoy,
  Lightbulb,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOURS } from '@/lib/copilot/tours';
import { useCopilot } from './copilot-context';
import { useT } from '@/hooks/use-locale';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Present when the answer lives in the shared learning cache —
   *  enables the 👍/👎 feedback row under the bubble. */
  cacheId?: string;
  /** Local one-vote-per-bubble state. */
  voted?: 'up' | 'down';
  /** The ask was for something ConvoReal can't do — the server logged
   *  it as a feature request, so tell the user it landed somewhere. */
  unsupported?: boolean;
  /** The question this answer replied to — carried on the turn so the
   *  support form doesn't have to walk back through the history. */
  question?: string;
  /** Set once a support ticket was filed from this turn. */
  supportRef?: string;
}

const SUGGESTIONS = [
  'How do I add a contact?',
  'Send message to many people',
  'Property views kaise dekhu?',
];

const GREETING =
  'Hi! I can show you around or answer questions about ConvoReal. \u{1F44B}';

export function CopilotPanel() {
  const { panelOpen, closePanel, startTour } = useCopilot();
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [supportFor, setSupportFor] = useState<number | null>(null);
  const [supportChannel, setSupportChannel] = useState<'whatsapp' | 'email'>(
    'whatsapp'
  );
  const [supportDest, setSupportDest] = useState('');
  const [supportBusy, setSupportBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy, panelOpen]);

  if (!panelOpen) return null;

  const sendFeedback = (turnIndex: number, vote: 'up' | 'down') => {
    setTurns((t) =>
      t.map((turn, i) => (i === turnIndex ? { ...turn, voted: vote } : turn))
    );
    const cacheId = turns[turnIndex]?.cacheId;
    if (!cacheId) return;
    // Fire-and-forget — feedback must never interrupt the chat.
    void fetch('/api/copilot/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cacheId, vote }),
    }).catch(() => {});
  };

  const fileSupportTicket = async (turnIndex: number) => {
    const turn = turns[turnIndex];
    if (!turn?.question || supportBusy) return;
    setSupportBusy(true);
    try {
      const res = await fetch('/api/copilot/support-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: turn.question,
          helper_reply: turn.text,
          platform: 'web',
          pathname,
          channel: supportChannel,
          destination: supportDest,
        }),
      });
      const data: { reference?: string; error?: string } = await res.json();
      if (!res.ok || !data.reference) {
        throw new Error(data.error || 'Failed');
      }
      setTurns((t) =>
        t.map((x, i) =>
          i === turnIndex ? { ...x, supportRef: data.reference } : x
        )
      );
      setSupportFor(null);
      setSupportDest('');
    } catch {
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          text: "Couldn't reach the support desk just now — please try again in a minute.",
        },
      ]);
    } finally {
      setSupportBusy(false);
    }
  };

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    setInput('');
    setShowGuides(false);
    setTurns((t) => [...t, { role: 'user', text: message }]);
    setBusy(true);
    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          pathname,
          history: turns.slice(-6),
        }),
      });
      if (res.status === 429) {
        setTurns((t) => [
          ...t,
          {
            role: 'assistant',
            text: "You're asking very fast! Give me a minute and try again \u{1F60A}",
          },
        ]);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: {
        reply: string;
        tourId?: string;
        navigateTo?: string;
        cacheId?: string;
        unsupported?: boolean;
      } = await res.json();
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          text: data.reply,
          cacheId: data.cacheId,
          unsupported: data.unsupported,
          question: message,
        },
      ]);
      if (data.tourId) {
        startTour(data.tourId); // closes the panel via startTour
      } else if (data.navigateTo) {
        router.push(data.navigateTo);
      }
    } catch {
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          text: 'Sorry, something went wrong. Please try again — or pick a guide below.',
        },
      ]);
      setShowGuides(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="ConvoReal helper"
      className={cn(
        'fixed z-[60] flex flex-col overflow-hidden border border-slate-800 bg-slate-950/95 shadow-2xl shadow-black/50 backdrop-blur-xl',
        // Mobile: bottom sheet. Desktop: floating card above the button.
        'inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl',
        'sm:inset-x-auto sm:right-5 sm:bottom-24 sm:max-h-[70vh] sm:w-[360px] sm:rounded-2xl'
      )}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="from-primary to-indigo-650 flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <p className="text-sm font-bold text-white">Helper</p>
        </div>
        <button
          type="button"
          onClick={closePanel}
          aria-label="Close helper"
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="rounded-xl rounded-tl-sm bg-slate-900 px-3 py-2 text-sm text-slate-200">
          {GREETING}
        </div>

        {/* Suggestion chips — these hit the deterministic intent
            matcher server-side, so the most common questions never
            reach the AI. */}
        {turns.length === 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="hover:border-primary/40 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Chat turns */}
        <div className="mt-3 flex flex-col gap-2">
          {turns.map((turn, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[85%]',
                turn.role === 'user' ? 'self-end' : 'self-start'
              )}
            >
              <div
                className={cn(
                  'rounded-xl px-3 py-2 text-sm',
                  turn.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'rounded-tl-sm bg-slate-900 text-slate-200'
                )}
              >
                {turn.text}
              </div>
              {/* Closes the loop on a "we can't do that" answer: the
                  request was logged for the product team. */}
              {turn.role === 'assistant' && turn.unsupported && (
                <p className="mt-1 flex items-center gap-1 pl-1 text-[10px] text-slate-500">
                  <Lightbulb className="h-3 w-3 shrink-0" />
                  {t('copilot.featureNoted')}
                </p>
              )}
              {/* Escalation to a human: an unanswered (or unsupported)
                  question can be handed to the help desk, answered
                  back on WhatsApp or email. */}
              {turn.role === 'assistant' &&
                turn.unsupported &&
                turn.question &&
                (turn.supportRef ? (
                  <p className="mt-1 flex items-center gap-1 pl-1 text-[10px] text-emerald-400">
                    <LifeBuoy className="h-3 w-3 shrink-0" />
                    {t('copilot.supportSent')} {turn.supportRef}.{' '}
                    {t('copilot.supportReply')} {supportChannel}.
                  </p>
                ) : supportFor === i ? (
                  <div className="mt-2 flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-xs font-semibold text-white">
                      {t('copilot.supportWhere')}
                    </p>
                    <div className="flex gap-1.5">
                      {(['whatsapp', 'email'] as const).map((ch) => (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => setSupportChannel(ch)}
                          className={cn(
                            'rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize',
                            supportChannel === ch
                              ? 'border-primary/50 bg-primary/15 text-white'
                              : 'border-slate-700 text-slate-400'
                          )}
                        >
                          {ch}
                        </button>
                      ))}
                    </div>
                    <input
                      value={supportDest}
                      onChange={(e) => setSupportDest(e.target.value)}
                      placeholder={
                        supportChannel === 'whatsapp'
                          ? t('copilot.supportPhone')
                          : t('copilot.supportEmail')
                      }
                      className="focus:border-primary/50 h-8 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={supportBusy || !supportDest.trim()}
                        onClick={() => void fileSupportTicket(i)}
                        className="bg-primary text-primary-foreground rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-40"
                      >
                        {supportBusy
                          ? t('copilot.supportSending')
                          : t('copilot.supportSend')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSupportFor(null)}
                        className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-400"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSupportFor(i)}
                    className="text-primary mt-1 flex items-center gap-1 pl-1 text-[11px] font-medium hover:underline"
                  >
                    <LifeBuoy className="h-3 w-3 shrink-0" />
                    {t('copilot.askSupport')}
                  </button>
                ))}
              {/* Feedback row — the community signal that teaches the
                  helper which learned answers to keep serving. */}
              {turn.role === 'assistant' && turn.cacheId && (
                <div className="mt-1 flex items-center gap-1 pl-1">
                  {turn.voted ? (
                    <span className="text-[10px] text-slate-500">
                      Thanks for the feedback!
                    </span>
                  ) : (
                    <>
                      <span className="text-[10px] text-slate-500">
                        Helpful?
                      </span>
                      {(['up', 'down'] as const).map((vote) => (
                        <button
                          key={vote}
                          type="button"
                          aria-label={vote === 'up' ? 'Helpful' : 'Not helpful'}
                          onClick={() => sendFeedback(i, vote)}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-white"
                        >
                          {vote === 'up' ? (
                            <ThumbsUp className="h-3 w-3" />
                          ) : (
                            <ThumbsDown className="h-3 w-3" />
                          )}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="self-start rounded-xl rounded-tl-sm bg-slate-900 px-3 py-2 text-sm text-slate-400">
              <span className="motion-safe:animate-pulse">Typing…</span>
            </div>
          )}
        </div>

        {/* Guides list */}
        {showGuides && (
          <div className="mt-4">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black tracking-widest text-slate-500 uppercase">
              <Compass className="h-3 w-3" /> Step-by-step guides
            </p>
            <div className="flex flex-col gap-1.5">
              {TOURS.map((tour) => (
                <button
                  key={tour.id}
                  type="button"
                  onClick={() => startTour(tour.id)}
                  className="hover:border-primary/40 rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5 text-left transition-colors hover:bg-slate-900"
                >
                  <p className="text-sm font-semibold text-white">
                    {tour.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {tour.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        className="flex shrink-0 items-center gap-2 border-t border-slate-800/80 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask me anything…"
          maxLength={500}
          aria-label="Ask the helper"
          className="focus:border-primary/50 h-10 flex-1 rounded-xl border border-slate-800 bg-slate-900/60 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-10 w-10 items-center justify-center rounded-xl disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
