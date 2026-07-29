'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface BotMessage {
  id: string;
  role: 'user' | 'bot';
  text: string;
  /** Rendered under the bubble — match cards, a WhatsApp handoff, etc. */
  attachment?: ReactNode;
}

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
}: LeadBotProps) {
  const [open, setOpen] = useState(variant === 'inline' || defaultOpen);
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: 'smooth',
    });
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

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-3 print:hidden">
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
          type="button"
          onClick={() => setOpen(true)}
          className="bg-primary hover:bg-primary-hover text-primary-foreground shadow-primary/30 flex cursor-pointer items-center gap-2 rounded-full py-3 pr-4 pl-3 text-xs font-bold shadow-2xl transition-all hover:scale-105"
        >
          <MessageCircle className="size-4" />
          {launcherLabel}
        </button>
      )}
    </div>
  );
}
