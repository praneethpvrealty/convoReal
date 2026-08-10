'use client';

// ============================================================
// The Portfolio helper — floating button + chat panel for the owner
// and buyer portals.
//
// Deliberately not the dashboard CopilotWidget: that one carries the
// guided-tour engine and the proactive-nudge hook, both of which
// spotlight and query staff-only surfaces. Portal users get the part
// that makes sense for them — ask a question, get an answer — against
// their own audience's corpus.
//
// Kill switch: NEXT_PUBLIC_COPILOT_ENABLED=false disables the helper
// everywhere, portals included.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Lightbulb, Send, Sparkles, X } from 'lucide-react';

import { cn } from '@/lib/utils';

const COPILOT_ENABLED = process.env.NEXT_PUBLIC_COPILOT_ENABLED !== 'false';
const MAX_HISTORY_TURNS = 6;

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  unsupported?: boolean;
}

export interface PortalHelperProps {
  /** Which portal this is — picks the API route and the copy. */
  audience: 'owner' | 'buyer';
}

const COPY: Record<
  PortalHelperProps['audience'],
  { endpoint: string; greeting: string; suggestions: string[] }
> = {
  owner: {
    endpoint: '/api/den/copilot',
    greeting:
      'Hi! Ask me anything about your Portfolio — what the numbers mean, how offers work, or who can see what. \u{1F44B}',
    suggestions: [
      'What is Deal Mode?',
      'Who can see my details?',
      'How do offers work?',
    ],
  },
  buyer: {
    endpoint: '/api/buyer/copilot',
    greeting:
      'Hi! Ask me anything about your Portfolio — your shortlist, how matches are picked, or what happens next. \u{1F44B}',
    suggestions: [
      'How are matches chosen?',
      'How do I book a site visit?',
      'What can the agent see?',
    ],
  },
};

export function PortalHelper({ audience }: PortalHelperProps) {
  const { endpoint, greeting, suggestions } = COPY[audience];
  const pathname = usePathname();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy, open]);

  if (!COPILOT_ENABLED) return null;

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    setInput('');
    setTurns((t) => [...t, { role: 'user', text: message }]);
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          pathname,
          history: turns.slice(-MAX_HISTORY_TURNS),
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
        navigateTo?: string;
        unsupported?: boolean;
      } = await res.json();
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          text: data.reply,
          unsupported: data.unsupported,
        },
      ]);
      if (data.navigateTo) router.push(data.navigateTo);
    } catch {
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          text: 'Sorry, something went wrong. Please try again, or ask your agent.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Help"
        className="bg-primary text-primary-foreground shadow-primary/30 fixed right-5 bottom-20 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 md:bottom-5"
      >
        <Sparkles className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Portfolio helper"
      className={cn(
        'bg-background fixed z-50 flex flex-col overflow-hidden border shadow-2xl',
        'inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl',
        'sm:inset-x-auto sm:right-5 sm:bottom-24 sm:max-h-[70vh] sm:w-[360px] sm:rounded-2xl'
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="bg-primary/10 border-primary/20 flex h-7 w-7 items-center justify-center rounded-lg border">
            <Sparkles className="text-primary h-3.5 w-3.5" />
          </span>
          <p className="text-sm font-black tracking-tight">Helper</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close helper"
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-8 w-8 items-center justify-center rounded-md"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="bg-muted rounded-xl rounded-tl-sm px-3 py-2 text-sm">
          {greeting}
        </div>

        {turns.length === 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="hover:border-primary/40 hover:text-foreground text-muted-foreground rounded-full border px-3 py-1.5 text-xs font-medium"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {turns.map((t, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[85%]',
                t.role === 'user' ? 'self-end' : 'self-start'
              )}
            >
              <div
                className={cn(
                  'rounded-xl px-3 py-2 text-sm',
                  t.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-muted rounded-tl-sm'
                )}
              >
                {t.text}
              </div>
              {t.role === 'assistant' && t.unsupported && (
                <p className="text-muted-foreground mt-1 flex items-center gap-1 pl-1 text-[10px]">
                  <Lightbulb className="h-3 w-3 shrink-0" />
                  Noted as a request for the ConvoReal team.
                </p>
              )}
            </div>
          ))}
          {busy && (
            <div className="bg-muted text-muted-foreground self-start rounded-xl rounded-tl-sm px-3 py-2 text-sm">
              <span className="motion-safe:animate-pulse">Typing…</span>
            </div>
          )}
        </div>
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-t p-3"
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
          className="focus:border-primary/50 h-10 flex-1 rounded-xl border bg-transparent px-3 text-sm focus:outline-none"
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
