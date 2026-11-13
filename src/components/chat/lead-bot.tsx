'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { controlsUnderBox, launcherLift } from '@/lib/chat/launcher-dodge';

export interface BotMessage {
  id: string;
  role: 'user' | 'bot';
  text: string;
  /** Rendered under the bubble — match cards, a WhatsApp handoff, etc. */
  attachment?: ReactNode;
}

const LAUNCHER_COMPACT_AFTER = 240;

interface LeadBotProps {
  /** 'floating' launches from a corner bubble; 'inline' sits in the page. */
  variant: 'floating' | 'inline';
  title: string;
  subtitle?: string;
  messages: BotMessage[];
  chips?: string[];
  /** Chips stay selected and the visitor confirms with the button. */
  multiSelect?: boolean;
  selectedChips?: string[];
  confirmLabel?: string;
  onConfirm?: () => void;
  onChip: (chip: string) => void;
  onSend: (text: string) => void;
  inputMode?: 'text' | 'tel';
  placeholder?: string;
  loading?: boolean;
  /** Shown once the funnel completes instead of the composer. */
  footer?: ReactNode;
  /** Floating only — the launcher's resting label. */
  launcherLabel?: string;
  /** Floating only — open on first paint (used after a page-level CTA). */
  defaultOpen?: boolean;
  /** Floating only — keep the closed launcher off screen while another
   *  surface owns the bottom edge; an open chat stays where it is. */
  launcherHidden?: boolean;
  /** Floating only — shrink the closed launcher to its icon once the page
   *  scrolls, so it stops covering the content underneath. */
  launcherCompactOnScroll?: boolean;
  /** Floating only — lift the closed launcher above a button, link or field
   *  that scrolls underneath it, and drop it back once the corner is clear. */
  launcherDodgesControls?: boolean;
}

export function LeadBot({
  variant,
  title,
  subtitle,
  messages,
  chips = [],
  multiSelect = false,
  selectedChips = [],
  confirmLabel = 'Continue',
  onConfirm,
  onChip,
  onSend,
  inputMode = 'text',
  placeholder = 'Type your answer…',
  loading = false,
  footer,
  launcherLabel = 'Chat with us',
  defaultOpen = false,
  launcherHidden = false,
  launcherCompactOnScroll = false,
  launcherDodgesControls = false,
}: LeadBotProps) {
  const [open, setOpen] = useState(variant === 'inline' || defaultOpen);
  const [scrolled, setScrolled] = useState(false);
  const [lift, setLift] = useState(0);
  const floatingRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (variant !== 'floating' || !launcherCompactOnScroll) return;
    const update = () => setScrolled(window.scrollY > LAUNCHER_COMPACT_AFTER);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [variant, launcherCompactOnScroll]);

  const dodging =
    variant === 'floating' &&
    launcherDodgesControls &&
    !open &&
    !launcherHidden;

  useEffect(() => {
    if (!dodging) return;
    let frame = 0;
    let pending = false;
    const measure = () => {
      pending = false;
      const container = floatingRef.current;
      const launcher = launcherRef.current;
      if (!container || !launcher) return;
      const rect = launcher.getBoundingClientRect();
      const bottom = container.offsetTop + container.offsetHeight;
      const rest = {
        top: bottom - launcher.offsetHeight,
        bottom,
        left: rect.left,
        right: rect.right,
      };
      const next = launcherLift(
        rest,
        (box) => controlsUnderBox(box, container),
        Math.min(240, window.innerHeight * 0.4)
      );
      setLift(next);
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      if (typeof window.requestAnimationFrame === 'function') {
        frame = window.requestAnimationFrame(measure);
      } else {
        measure();
      }
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (pending && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [dodging, scrolled]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread && typeof thread.scrollTo === 'function') {
      thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, loading, chips]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || loading) return;
    setDraft('');
    onSend(text);
  }

  const conversation = (
    <>
      <div
        ref={threadRef}
        className={cn(
          'space-y-3 overflow-y-auto pr-1',
          variant === 'floating'
            ? 'max-h-[60vh] min-h-56'
            : 'max-h-[26rem] min-h-40'
        )}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={msg.role === 'user' ? 'flex justify-end' : 'space-y-2'}
          >
            <div
              className={cn(
                'px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap',
                msg.role === 'user'
                  ? 'bg-primary/90 text-primary-foreground max-w-[85%] rounded-lg rounded-br-sm'
                  : 'max-w-[92%] rounded-lg rounded-bl-sm bg-slate-900 text-slate-100'
              )}
            >
              {msg.text}
            </div>
            {msg.attachment}
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-400">
              <Loader2 className="size-3.5 animate-spin" /> Thinking…
            </div>
          </div>
        )}
      </div>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => {
            const active = selectedChips.some(
              (c) => c.toLowerCase() === chip.toLowerCase()
            );
            return (
              <button
                key={chip}
                type="button"
                disabled={loading}
                onClick={() => onChip(chip)}
                className={cn(
                  'cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50',
                  active
                    ? 'border-primary bg-primary/15 text-white'
                    : 'hover:border-primary border-slate-800 text-slate-300 hover:text-white'
                )}
              >
                {chip}
              </button>
            );
          })}
          {multiSelect && onConfirm && (
            <button
              type="button"
              disabled={loading}
              onClick={onConfirm}
              className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          )}
        </div>
      )}

      {footer ? (
        <div className="mt-3">{footer}</div>
      ) : (
        <form onSubmit={submit} className="mt-3 flex gap-2">
          <Input
            type={inputMode === 'tel' ? 'tel' : 'text'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="border-slate-850 focus:border-primary bg-slate-950 text-xs text-white placeholder:text-slate-600"
          />
          <Button
            type="submit"
            disabled={loading || !draft.trim()}
            aria-label="Send"
            className="bg-primary hover:bg-primary-hover text-primary-foreground px-3"
          >
            <Send className="size-4" />
          </Button>
        </form>
      )}
    </>
  );

  if (variant === 'inline') {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="text-primary size-4" />
          <div>
            <h4 className="text-xs font-bold tracking-wider text-white uppercase">
              {title}
            </h4>
            {subtitle && (
              <p className="text-[11px] text-slate-400">{subtitle}</p>
            )}
          </div>
        </div>
        {conversation}
      </div>
    );
  }

  if (!open && launcherHidden) return null;
  const compact = launcherCompactOnScroll && scrolled;
  const appliedLift = dodging ? lift : 0;

  return (
    <div
      ref={floatingRef}
      data-floating-lead-bot
      data-lift={appliedLift || undefined}
      style={
        appliedLift ? { transform: `translateY(-${appliedLift}px)` } : undefined
      }
      className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-3 motion-safe:transition-transform motion-safe:duration-200 print:hidden"
    >
      {open && (
        <div className="animate-zoom-in w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-slate-800 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-xl">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="text-primary size-4 shrink-0" />
              <div>
                <h4 className="text-xs font-bold tracking-wider text-white uppercase">
                  {title}
                </h4>
                {subtitle && (
                  <p className="text-[11px] text-slate-400">{subtitle}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="cursor-pointer rounded-full p-1 text-slate-500 hover:bg-slate-900 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
          {conversation}
        </div>
      )}

      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={compact ? launcherLabel : undefined}
          title={compact ? launcherLabel : undefined}
          data-compact={compact || undefined}
          className={cn(
            'bg-primary hover:bg-primary-hover text-primary-foreground shadow-primary/30 flex cursor-pointer items-center gap-2 rounded-full text-xs font-bold shadow-2xl transition-all hover:scale-105',
            compact ? 'p-3' : 'py-3 pr-4 pl-3'
          )}
        >
          <MessageCircle className="size-4" />
          {!compact && launcherLabel}
        </button>
      )}
    </div>
  );
}
