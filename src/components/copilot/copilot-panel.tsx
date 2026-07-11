"use client";

// ============================================================
// The helper chat panel: greeting, quick-suggestion chips, the
// guided-tour list, and a free-form chat wired to POST /api/copilot.
// History is held in component state only (last 6 turns are sent to
// the API) — nothing is persisted.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Compass, Send, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOURS } from "@/lib/copilot/tours";
import { useCopilot } from "./copilot-context";

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Present when the answer lives in the shared learning cache —
   *  enables the 👍/👎 feedback row under the bubble. */
  cacheId?: string;
  /** Local one-vote-per-bubble state. */
  voted?: "up" | "down";
}

const SUGGESTIONS = [
  "How do I add a contact?",
  "Send message to many people",
  "Property views kaise dekhu?",
];

const GREETING =
  "Hi! I can show you around or answer questions about ConvoReal. \u{1F44B}";

export function CopilotPanel() {
  const { panelOpen, closePanel, startTour } = useCopilot();
  const pathname = usePathname();
  const router = useRouter();

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy, panelOpen]);

  if (!panelOpen) return null;

  const sendFeedback = (turnIndex: number, vote: "up" | "down") => {
    setTurns((t) =>
      t.map((turn, i) => (i === turnIndex ? { ...turn, voted: vote } : turn)),
    );
    const cacheId = turns[turnIndex]?.cacheId;
    if (!cacheId) return;
    // Fire-and-forget — feedback must never interrupt the chat.
    void fetch("/api/copilot/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cacheId, vote }),
    }).catch(() => {});
  };

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    setInput("");
    setShowGuides(false);
    setTurns((t) => [...t, { role: "user", text: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
            role: "assistant",
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
      } = await res.json();
      setTurns((t) => [
        ...t,
        { role: "assistant", text: data.reply, cacheId: data.cacheId },
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
          role: "assistant",
          text: "Sorry, something went wrong. Please try again — or pick a guide below.",
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
        "fixed z-[60] flex flex-col overflow-hidden border border-slate-800 bg-slate-950/95 backdrop-blur-xl shadow-2xl shadow-black/50",
        // Mobile: bottom sheet. Desktop: floating card above the button.
        "inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl",
        "sm:inset-x-auto sm:bottom-24 sm:right-5 sm:w-[360px] sm:max-h-[70vh] sm:rounded-2xl",
      )}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-indigo-650 text-white">
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
                className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-primary/40 hover:text-white"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Chat turns */}
        <div className="mt-3 flex flex-col gap-2">
          {turns.map((t, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%]",
                t.role === "user" ? "self-end" : "self-start",
              )}
            >
              <div
                className={cn(
                  "rounded-xl px-3 py-2 text-sm",
                  t.role === "user"
                    ? "rounded-br-sm bg-primary text-primary-foreground"
                    : "rounded-tl-sm bg-slate-900 text-slate-200",
                )}
              >
                {t.text}
              </div>
              {/* Feedback row — the community signal that teaches the
                  helper which learned answers to keep serving. */}
              {t.role === "assistant" && t.cacheId && (
                <div className="mt-1 flex items-center gap-1 pl-1">
                  {t.voted ? (
                    <span className="text-[10px] text-slate-500">
                      Thanks for the feedback!
                    </span>
                  ) : (
                    <>
                      <span className="text-[10px] text-slate-500">Helpful?</span>
                      {(["up", "down"] as const).map((vote) => (
                        <button
                          key={vote}
                          type="button"
                          aria-label={vote === "up" ? "Helpful" : "Not helpful"}
                          onClick={() => sendFeedback(i, vote)}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-white"
                        >
                          {vote === "up" ? (
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
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <Compass className="h-3 w-3" /> Step-by-step guides
            </p>
            <div className="flex flex-col gap-1.5">
              {TOURS.map((tour) => (
                <button
                  key={tour.id}
                  type="button"
                  onClick={() => startTour(tour.id)}
                  className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-slate-900"
                >
                  <p className="text-sm font-semibold text-white">{tour.title}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{tour.description}</p>
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
          className="h-10 flex-1 rounded-xl border border-slate-800 bg-slate-900/60 px-3 text-sm text-white placeholder:text-slate-500 focus:border-primary/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
